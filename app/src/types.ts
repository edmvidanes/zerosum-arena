export type PlayerStatus = 'LOBBY' | 'PLAYING' | 'WAITING' | 'ELIMINATED' | 'CHAMPION';
export type ArenaTone = 'RESPECTFUL' | 'FRIENDLY' | 'COMPETITIVE' | 'RAGEBAIT' | 'NO_MERCY';

export interface PublicPlayer {
  id: string;
  name: string;
  avatar: string;
  hp: number;
  status: PlayerStatus;
  matchId?: string;
  isBot?: boolean;
  botTier?: string;
  isHostPlayer?: boolean;
}

export interface MatchSummary {
  id: string;
  participantIds: string[];
  aliveIds: string[];
  phase: 'ANSWERING' | 'RESOLVING' | 'COMPLETE';
  questionNumber: number;
  winnerId?: string;
}

export interface MatchHistoryEntry extends MatchSummary {
  round: number;
  hp: Record<string, number>;
  questionIds: string[];
}

export interface QuestionView {
  id: string;
  domain?: number;
  text: string;
  options: string[];
  nonce: string;
  deadline: number;
  number: number;
}

export interface QuestionPreview {
  id: string;
  domain?: number;
  type?: 'MULTIPLE_CHOICE' | 'TRUE_FALSE';
  text: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  difficulty: 'basic' | 'scenario';
}

export interface CombatFeedback {
  key: string;
  at: number;
  questionNumber: number;
  fastestCorrectId?: string;
  winnerId?: string;
  damagedIds: string[];
  eliminatedIds: string[];
  correctIndex?: number;
  explanation?: string;
  myCorrect?: boolean;
}

export interface AuditEvent {
  id: string;
  at: number;
  kind: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface Snapshot {
  type: 'snapshot';
  tournament: {
    code: string;
    phase: 'LOBBY' | 'IN_ROUND' | 'ROUND_BREAK' | 'COMPLETE' | 'CANCELLED';
    round: number;
    playerCount: number;
    activeCount: number;
    championId?: string;
    flawlessBonus: boolean;
    questionSeconds: number;
    arenaTone: ArenaTone;
    maxPlayers: number;
    bankId: string;
    bankName: string;
    gameMode: 'QUIZ' | 'RPS';
    mode: 'CLASS' | 'SOLO';
    hostPlay: boolean;
    feedbackMode: 'LEARN' | 'EXAM';
    allowChallenge: boolean;
    ladderLength: number;
    streak: number;
    rivalIndex: number;
    lobbyExpiresAt?: number;
  };
  players: PublicPlayer[];
  matches: MatchSummary[];
  matchHistory?: MatchHistoryEntry[];
  me?: PublicPlayer;
  combat?: CombatFeedback;
  question?: QuestionView;
  questionBank?: QuestionPreview[];
  reviewQuestions?: QuestionPreview[];
  questionBankInfo?: {
    title: string;
    version: number;
    eligibleQuestions: number;
    totalQuestions: number;
    excludedMultiSelect: number;
  };
  events?: AuditEvent[];
  serverNow: number;
  notice?: string;
}

export interface PlanLimits {
  players: number;
  banks: number;
  questionsPerBank: number;
  totalQuestions: number;
}

export interface Account {
  id: string;
  email: string;
  displayName: string;
  plan: 'FREE' | 'PAID';
  isAdmin?: boolean;
  limits: PlanLimits;
}

export interface BankSummary {
  id: string;
  name: string;
  description: string;
  version: number;
  questionCount: number;
  createdAt: number;
  updatedAt: number;
  isSample: number;
  hidden?: number;
  gameMode: 'QUIZ' | 'RPS';
}

export interface ProgressionPayload {
  type: 'progression';
  tournament: Snapshot['tournament'];
  players: PublicPlayer[];
  matchHistory: MatchHistoryEntry[];
}

export interface LeaderboardReport {
  type: 'leaderboard';
  tournament: Snapshot['tournament'];
  players: PublicPlayer[];
  matchHistory: MatchHistoryEntry[];
}

export type ServerMessage = Snapshot | {
  type: 'created'; code: string; hostToken: string; playerId?: string; playerToken?: string;
} | {
  type: 'joined'; code: string; playerId: string; playerToken: string;
} | {
  type: 'soloCreated'; code: string; playerId: string; playerToken: string;
} | {
  type: 'queued'; bankId: string; queueToken: string; position: number;
} | {
  type: 'queueStatus'; status: 'WAITING' | 'MATCHED' | 'EXPIRED'; position?: number; code?: string;
} | {
  type: 'challengeMatched'; code: string; playerId: string;
} | {
  type: 'queueLeft';
} | {
  type: 'error'; message: string;
} | TournamentReport | ProgressionPayload | LeaderboardReport;

export interface TournamentReport {
  type: 'report';
  tournament: Snapshot['tournament'];
  players: PublicPlayer[];
  matchHistory: MatchHistoryEntry[];
  reviewQuestions: QuestionPreview[];
  events: AuditEvent[];
}
