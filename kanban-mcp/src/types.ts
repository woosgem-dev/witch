export type CardStatus = 'Todo' | 'In Progress' | 'Review' | 'Done';
export type Priority = 'low' | 'medium' | 'high';

export interface Log {
  timestamp: string;
  agent: string;
  message: string;
}

export interface Card {
  id: string;
  title: string;
  description: string;
  status: CardStatus;
  archived: boolean;
  assignee: string | null;
  priority: Priority;
  tags: string[];
  externalRef: string | null;
  dependencies: string[];
  dependents: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  logs: Log[];
}

export interface Board {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  cards: Card[];
}

export interface BoardState {
  board: Board;
}

export type MutationEvent =
  | 'card_created'
  | 'card_updated'
  | 'card_assigned'
  | 'log_added'
  | 'card_archived'
  | 'dependency_added'
  | 'dependency_removed';

export type OnMutateCallback = (event: MutationEvent, card: Card) => void;
