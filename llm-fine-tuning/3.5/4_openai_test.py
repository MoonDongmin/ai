# → Structured Outputs를 사용해 생성된 평가 포맷의 정확성을 높이고
# → pqdm을 통해 병렬 처리를 구현함으로써 대량의 QA 쌍을 신속하게 채점할 수 있도록 설계함
import os
import json
import pandas as pd 
from pathlib import Path
from functools import partial
from pqdm.processes import pqdm
from openai import OpenAI
from pydantic import BaseModel

# OpenAI 클라이언트를 생성함
def get_openai_client():
    return OpenAI(api_key="Your_OpenAI_API_KEY")

class Criterion(BaseModel):
    score: int
    explanation: str

# 전체 평가 구조를 정의함. 관련성, 정확성, 완전성, 명확성, 유사성, ...
# 이를 커스터마이징해 평가하고 싶은 영역을 수정할 수 있음
class Evaluation(BaseModel):
    relevance: Criterion
    accuracy: Criterion
    completeness: Criterion
    clarity: Criterion
    similarity: Criterion
    average_score: float

# 프롬프트와 평가한 파일을 저장하는 함수
def evaluate_qa_pair(idx, qa_pairs):
    client = get_openai_client()  # 각 프로세스마다 새로운 클라이언트 생성
    save_path = f"./qa_evaluation_results/result_{idx}.json"
    if Path(save_path).exists():
        print(f"인덱스 {idx}에 대한 결과가 이미 존재합니다.")
        return None
    
    question, reference_answer, model_answer = qa_pairs[idx]
    
    prompt = f"""
질문: {question}
참조 답변: {reference_answer}
모델 생성 답변: {model_answer}

위의 질문에 대한 두 답변을 비교 평가해주세요. 다음 기준에 따라 1-10점 사이의 점수를 매겨주세요:
1. 관련성: 모델의 답변이 질문과 얼마나 관련이 있는가?
2. 정확성: 모델이 제공한 정보가 참조 답변과 비교하여 얼마나 정확한가?
3. 완전성: 모델의 답변이 질문에 대해 얼마나 포괄적인가?
4. 명확성: 모델의 답변이 얼마나 명확하고 이해하기 쉬운가?
5. 유사성: 모델의 답변이 참조 답변과 얼마나 유사한가?

각 기준에 대한 점수와 간단한 설명을 제공해주세요. 마지막으로 전체 평균 점수를 계산해주세요.
"""

    try:
        completion = client.beta.chat.completions.parse(
            model="gpt-4o-mini",  # 또는 사용 가능한 최신 모델
            messages=[
                {"role": "system", "content": "QA 모델 응답을 평가하는 임무를 맡은 AI 어시스턴트입니다."},
                {"role": "user", "content": prompt}
            ],
            response_format=Evaluation
        )

        # 결과를 JSON 파일로 저장
        with open(save_path, "w", encoding="utf-8") as f:
            json.dump(completion.model_dump(), f, ensure_ascii=False, indent=4)

        return completion
    except Exception as e:
        print(f"Error processing index {idx}: {str(e)}")
        return None

# 메인함수에 넣고 pqdm으로 병렬 처리를 실행함.
def main():
    # 해당 파일에서 데이터를 읽어옴
    data = open("./test/model_generation_result.txt", "r")
    
    # 이를 파이썬 객체로 변환해서 qa_pairs리스트를 만듬.
    data = [eval(line) for line in data]
    qa_pairs = pd.DataFrame(data, columns=["question", "answer", "generation"])
    qa_pairs = data 

    # qa_pairs에 인덱스 추가
    indexed_qa_pairs = list(range(len(qa_pairs)))
    # partial 함수를 사용하여 qa_pairs를 evaluate_qa_pair에 전달
    evaluate_func = partial(evaluate_qa_pair, qa_pairs=qa_pairs)
    # pqdm을 사용하여 병렬 처리(동시에 40개의 작업을 처리)
    results = pqdm(indexed_qa_pairs, evaluate_func, n_jobs=40)

if __name__ == "__main__":
    main()