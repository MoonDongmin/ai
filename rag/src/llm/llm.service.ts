import {Injectable}    from "@nestjs/common";
import {OpenAI}        from "openai";
import {ConfigService} from "@nestjs/config";

@Injectable()
export class LLMService {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(
    config: ConfigService,
  ) {
    this.client = new OpenAI({
      apiKey: config.getOrThrow<string>("openai.apiKey"),
    });
    this.model = config.getOrThrow<string>("openai.model");
  }

  async generate(systemPrompt: string, userMessage: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    return response.choices[0].message.content ?? "응답이 없습니다";
  }
}
