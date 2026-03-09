export class AgentQueryRequestDto {
  question: string;
}

export interface QuestionAnalysis {
  needsSql: boolean;
  analysis: string;
  entities: {
    deviceIds?: string[];
    metrics?: string[];
    dateFrom?: string;
    dateTo?: string;
    aggregation?: string;
    conditions?: string[];
  };
}

export interface GeneratedSql {
  sql: string;
  explanation: string;
}

export interface ValidatedSql {
  valid: boolean;
  sql: string;
  issues?: string[];
}

export interface AgentQueryResponse {
  answer: string;
  intent: "SQL" | "VECTOR";
  sql?: string;
  data?: unknown;
  sources?: Array<{ eventId: number; deviceId: string; similarity: number }>;
}
