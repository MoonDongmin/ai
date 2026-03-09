import {
  Body,
  Controller,
  Post,
}                          from "@nestjs/common";
import {QueryService}      from "@/query/query.service";
import {AgentQueryService} from "@/query/agent/agent-query.service";
import {
  AgentQueryRequestDto,
  AgentQueryResponse,
}                          from "@/query/dto/agent-query.dto";

@Controller("query")
export class QueryController {
  constructor(
    private readonly queryService: QueryService,
    private readonly agentQueryService: AgentQueryService,
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

  @Post("agent")
  async agentAsk(@Body() body: AgentQueryRequestDto): Promise<AgentQueryResponse> {
    return this.agentQueryService.ask(body.question);
  }

}
