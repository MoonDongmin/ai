import {
  Body,
  Controller,
  Post,
}                     from "@nestjs/common";
import {QueryService} from "@/query/query.service";

@Controller("query")
export class QueryController {
  constructor(
    private readonly queryService: QueryService,
  ) {
  }

  @Post()
  async ask(@Body() body: { question: string, deviceId?: string, topK?: number },
  ) {
    return this.queryService.ask(body.question, {
      deviceId: body.deviceId,
      topK: body.topK,
    });
  }

}
