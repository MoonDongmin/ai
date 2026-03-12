import logging
from dataclasses import dataclass, field
import os
import random
import torch
from datasets import load_dataset
from transformers import AutoTokenizer, TrainingArguments, BitsAndBytesConfig
from trl.commands.cli_utils import TrlParser
from transformers import AutoModelForCausalLM, set_seed
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from trl import SFTTrainer
from huggingface_hub import login

login(
    token=os.environ.get("HF_TOKEN"),
    add_to_git_credential=False
)

# 데이터셋 준비
# 이 데이터셋은 네이버 지식인의 베스트 질문들을 크롤링해 수집함
dataset = load_dataset("beomi/KoAlpaca-v1.1a")
columns_to_remove = list(dataset["train"].features)

system_prompt = "당신은 다양한 분야의 전문가들이 제공한 지식과 정보를 바탕으로 만들어진 AI 어시스턴트입니다. 사용자들의 질문에 대해 정확하고 유용한 답변을 제공하는 것이 당신의 주요 목표입니다. 복잡한 주제에 대해서도 이해하기 쉽게 설명할 수 있으며, 필요한 경우 추가 정보나 관련 예시를 제공할 수 있습니다. 항상 객관적이고 중립적인 입장을 유지하면서, 최신 정보를 반영하여 답변해 주세요. 사용자의 질문이 불분명한 경우 추가 설명을 요청하고, 당신이 확실하지 않은 정보에 대해서는 솔직히 모른다고 말해주세요."

train_dataset = dataset.map(
    lambda sample: {
        'messages': [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": sample['instruction']},
            {"role": "assistant", "content": sample['output']}
        ]
    },
)

train_dataset = train_dataset.map(remove_columns=columns_to_remove, batched=False)
train_dataset = train_dataset["train"].train_test_split(test_size=0.1, seed=42)
train_dataset["train"].to_json("train_dataset.json", orient="records", force_ascii=False)
train_dataset["test"].to_json("test_dataset.json", orient="records", force_ascii=False)


LLAMA_3_CHAT_TEMPLATE = (
    "{% for message in messages %}"
        "{% if message['role'] == 'system' %}"
            "{{ message['content'] }}"
        "{% elif message['role'] == 'user' %}"
            "{{ '\n\nHuman: ' + message['content'] + eos_token }}"
        "{% elif message['role'] == 'assistant' %}"
            "{{ '\n\nAssistant: ' + message['content'] + eos_token }}"
        "{% endif %}"
    "{% endfor %}"
    "{% if add_generation_prompt %}"
    "{{ '\n\nAssistant: ' }}"
    "{% endif %}"
)

### 3.5.4. Llama3 모델 파라미터 설정 
# @dataclass 데코레이터: 이는 코드의 가독성을 높이고 필요한 매개변수들을 체계적으로 관리할 수 있음
@dataclass
class ScriptArguments:
    # 데이터셋 파일의 경로를 의미
    dataset_path: str = field(default=None, metadata={"help": "데이터셋 파일 경로"})
    # 사용할 모델의 이름을 지정하는 데 사용
    model_name: str = field(default=None, metadata={"help": "SFT 학습에 사용할 모델 ID"})
    # 모델이 처리할 수 있는 입력 텍스트의 최대 길이(한 번에 다룰 수 있는 토큰의 최대 개수)
    max_seq_length: int = field(default=512, metadata={"help": "최대 시퀀스 길이"})
    question_key: str = field(default=None, metadata={"help": "질문 키"})
    answer_key: str = field(default=None, metadata={"help": "답변 키"})


### 3.5.5 Llama 3.1 모델 학습 코드 살펴보기
def training_function(script_args, training_args):
    # JSON 형식의 데이터셋 불러오기
    train_dataset = load_dataset(
        "json",
        data_files=os.path.join(script_args.dataset_path, "train_dataset.json"),
        split="train",
    )
    test_dataset = load_dataset(
        "json",
        data_files=os.path.join(script_args.dataset_path, "test_dataset.json"),
        split="train",
    )

    # 토크나이저 및 데이터셋 chat_template으로 변경하기
    # 모델에 맞는 토크나이저를 불러옴      
    tokenizer = AutoTokenizer.from_pretrained(script_args.model_name, use_fast=True)
    # padding 토큰이 없을 경우 EOS 토큰을 padding으로 사용
    tokenizer.pad_token = tokenizer.eos_token
    # 대화 데이터를 Llama-3 스타일 chat format으로 변환하기 위한 템플릿
    tokenizer.chat_template = LLAMA_3_CHAT_TEMPLATE
    # padding 문장을 오른쪽에 추가하도록
    tokenizer.padding_side = 'right'

    # 데이터셋의 messages 필드를 chat template 형식의 텍스트로 변환
    def template_dataset(examples):
        return {"text": tokenizer.apply_chat_template(examples["messages"], tokenize=False)}

    train_dataset = train_dataset.map(template_dataset, remove_columns=["messages"])
    test_dataset = test_dataset.map(template_dataset, remove_columns=["messages"])

    # 분산 학습 환경에서 메인 프로세스가 먼저 실행하도록 보장
    with training_args.main_process_first(desc="Log a few random samples"):
        for index in random.sample(range(len(train_dataset)), 2):
            print(train_dataset[index]["text"])

    # QLoRA: 4bit 양자화(속도 및 환경) -> 메모리 사용량이 적어짐
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.float16,
        bnb_4bit_use_double_quant=True,
    )

    model = AutoModelForCausalLM.from_pretrained(
        script_args.model_name,
        quantization_config=bnb_config,
        device_map="auto",
        attn_implementation="eager",
    )

    # LoRA 어댑터 추가(속도 및 환경)
    model = prepare_model_for_kbit_training(model)
    lora_config = LoraConfig(
        r=16,
        lora_alpha=32,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    # Train 설정 
    # SFTTrainer는 대규모 언어 모델을 특정 작업이나 도메인에 맞게 파인튜닝하는 데 사용되는 도구
    trainer = SFTTrainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        dataset_text_field="text",
        eval_dataset=test_dataset,
        max_seq_length=script_args.max_seq_length,
        tokenizer=tokenizer,
        packing=True,
        dataset_kwargs={
            "add_special_tokens": False,
            "append_concat_token": False,
        },
    )

    checkpoint = None
    if training_args.resume_from_checkpoint is not None:
        checkpoint = training_args.resume_from_checkpoint

    # 실제 학습을 시작하는 부분
    trainer.train(resume_from_checkpoint=checkpoint)
    trainer.save_model()


if __name__ == "__main__":
    parser = TrlParser((ScriptArguments, TrainingArguments))
    script_args, training_args = parser.parse_args_and_config()

    training_args.bf16 = False
    training_args.tf32 = False
    training_args.fp16 = True

    if training_args.gradient_checkpointing:
        training_args.gradient_checkpointing_kwargs = {"use_reentrant": True}

    set_seed(training_args.seed)
    training_function(script_args, training_args)

#chcp 65001
#$env:PYTHONUTF8="1"
#$env:PYTHONIOENCODING="utf-8"
#C:\Users\mobile\AppData\Local\mise\installs\python\3.12.13\python.exe ./1_train_full_fine_tuning.py --config ./0_full_fine_tuning_config.yaml
