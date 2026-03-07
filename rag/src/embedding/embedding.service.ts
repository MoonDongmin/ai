import {Injectable}    from "@nestjs/common";
import {ConfigService} from "@nestjs/config";

@Injectable()
export class EmbeddingService {
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(
    config: ConfigService,
  ) {
    this.baseUrl = config.getOrThrow<string>("ollama.baseUrl");
    this.model = config.getOrThrow<string>("ollama.model");
  }

  async embed(text: string) {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    const data = (await response.json()) as { embeddings: number[][] };
    return data.embeddings[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
      }),
    });

    const data = (await response.json()) as { embeddings: number[][] };
    return data.embeddings;
  }
}
