import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import type {
  Board,
  BoardState,
  Card,
  CardStatus,
  Log,
  OnMutateCallback,
  Priority,
} from './types.js';

export class StateManager {
  private filePath: string;
  private state: BoardState;
  private onMutate?: OnMutateCallback;

  constructor(filePath: string, onMutate?: OnMutateCallback) {
    this.filePath = filePath;
    this.onMutate = onMutate;
    this.state = this.load();
  }

  load(): BoardState {
    if (existsSync(this.filePath)) {
      const raw = readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw) as BoardState;
    }

    const now = new Date().toISOString();
    const state: BoardState = {
      board: {
        id: `board_${uuidv4()}`,
        name: 'Agent Board',
        createdAt: now,
        updatedAt: now,
        cards: [],
      },
    };
    this.save(state);
    return state;
  }

  save(state: BoardState): void {
    this.state = state;
    writeFileSync(this.filePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  getState(): BoardState {
    return this.state;
  }

  getBoardFilePath(): string {
    return this.filePath;
  }

  switchBoard(filePath: string, boardName?: string): BoardState {
    this.filePath = filePath;

    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, 'utf-8');
      this.state = JSON.parse(raw) as BoardState;
    } else {
      const now = new Date().toISOString();
      this.state = {
        board: {
          id: `board_${uuidv4()}`,
          name: boardName || 'Agent Board',
          createdAt: now,
          updatedAt: now,
          cards: [],
        },
      };
      this.save(this.state);
    }

    return this.state;
  }

  createCard(params: {
    title: string;
    description?: string;
    assignee?: string;
    priority?: Priority;
    tags?: string[];
    externalRef?: string;
    createdBy: string;
  }): Card {
    const now = new Date().toISOString();
    const card: Card = {
      id: `card_${uuidv4()}`,
      title: params.title,
      description: params.description ?? '',
      status: 'Todo',
      archived: false,
      assignee: params.assignee ?? null,
      priority: params.priority ?? 'medium',
      tags: params.tags ?? [],
      externalRef: params.externalRef ?? null,
      dependencies: [],
      dependents: [],
      createdBy: params.createdBy,
      createdAt: now,
      updatedAt: now,
      logs: [{ timestamp: now, agent: params.createdBy, message: 'Card created' }],
    };

    this.state.board.cards.push(card);
    this.state.board.updatedAt = now;
    this.save(this.state);
    this.onMutate?.('card_created', card);
    return card;
  }

  findCard(cardId: string): Card {
    const card = this.state.board.cards.find((c) => c.id === cardId);
    if (!card) {
      throw new Error(`Card not found: ${cardId}`);
    }
    return card;
  }

  updateStatus(
    cardId: string,
    status: CardStatus,
    logMessage?: string,
  ): Card | { error: 'BLOCKED'; blockedBy: string[] } {
    const card = this.findCard(cardId);

    if (status === 'In Progress' && card.dependencies.length > 0) {
      const blockedBy = card.dependencies.filter((depId) => {
        const dep = this.state.board.cards.find((c) => c.id === depId);
        return dep && dep.status !== 'Done';
      });

      if (blockedBy.length > 0) {
        return { error: 'BLOCKED', blockedBy };
      }
    }

    const now = new Date().toISOString();
    card.status = status;
    card.updatedAt = now;

    if (logMessage) {
      card.logs.push({ timestamp: now, agent: 'system', message: logMessage });
    }

    card.logs.push({
      timestamp: now,
      agent: 'system',
      message: `Status changed to "${status}"`,
    });

    this.state.board.updatedAt = now;
    this.save(this.state);
    this.onMutate?.('card_updated', card);
    return card;
  }

  assignCard(cardId: string, assignee: string): Card {
    const card = this.findCard(cardId);
    const now = new Date().toISOString();
    card.assignee = assignee;
    card.updatedAt = now;
    card.logs.push({
      timestamp: now,
      agent: 'system',
      message: `Assigned to "${assignee}"`,
    });

    this.state.board.updatedAt = now;
    this.save(this.state);
    this.onMutate?.('card_assigned', card);
    return card;
  }

  addLog(cardId: string, message: string, agent: string): Card {
    const card = this.findCard(cardId);
    const now = new Date().toISOString();
    const log: Log = { timestamp: now, agent, message };
    card.logs.push(log);
    card.updatedAt = now;

    this.state.board.updatedAt = now;
    this.save(this.state);
    this.onMutate?.('log_added', card);
    return card;
  }

  addDependency(cardId: string, dependsOn: string): Card {
    const card = this.findCard(cardId);
    const target = this.findCard(dependsOn);

    if (card.id === target.id) {
      throw new Error('A card cannot depend on itself');
    }

    if (card.dependencies.includes(dependsOn)) {
      return card;
    }

    if (this.wouldCreateCycle(cardId, dependsOn)) {
      throw new Error(
        `Adding dependency ${cardId} -> ${dependsOn} would create a cycle`,
      );
    }

    const now = new Date().toISOString();
    card.dependencies.push(dependsOn);
    target.dependents.push(cardId);
    card.updatedAt = now;
    target.updatedAt = now;

    this.state.board.updatedAt = now;
    this.save(this.state);
    this.onMutate?.('dependency_added', card);
    return card;
  }

  removeDependency(cardId: string, dependsOn: string): Card {
    const card = this.findCard(cardId);
    const target = this.findCard(dependsOn);

    card.dependencies = card.dependencies.filter((id) => id !== dependsOn);
    target.dependents = target.dependents.filter((id) => id !== cardId);

    const now = new Date().toISOString();
    card.updatedAt = now;
    target.updatedAt = now;

    this.state.board.updatedAt = now;
    this.save(this.state);
    this.onMutate?.('dependency_removed', card);
    return card;
  }

  archiveCard(cardId: string): Card {
    const card = this.findCard(cardId);
    const now = new Date().toISOString();
    card.archived = true;
    card.updatedAt = now;

    for (const other of this.state.board.cards) {
      if (other.id === cardId) continue;
      other.dependencies = other.dependencies.filter((id) => id !== cardId);
      other.dependents = other.dependents.filter((id) => id !== cardId);
    }

    card.dependencies = [];
    card.dependents = [];

    this.state.board.updatedAt = now;
    this.save(this.state);
    this.onMutate?.('card_archived', card);
    return card;
  }

  queryCards(filters?: {
    status?: CardStatus;
    assignee?: string;
    tag?: string;
    externalRef?: string;
    includeArchived?: boolean;
  }): Card[] {
    let cards = this.state.board.cards;

    if (!filters?.includeArchived) {
      cards = cards.filter((c) => !c.archived);
    }

    if (filters?.status) {
      cards = cards.filter((c) => c.status === filters.status);
    }

    if (filters?.assignee) {
      cards = cards.filter((c) => c.assignee === filters.assignee);
    }

    if (filters?.tag) {
      cards = cards.filter((c) => c.tags.includes(filters.tag!));
    }

    if (filters?.externalRef) {
      cards = cards.filter((c) => c.externalRef === filters.externalRef);
    }

    return cards;
  }

  // BFS cycle detection: check if adding edge cardId -> dependsOn creates a cycle
  private wouldCreateCycle(cardId: string, dependsOn: string): boolean {
    const visited = new Set<string>();
    const queue: string[] = [dependsOn];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === cardId) return true;
      if (visited.has(current)) continue;
      visited.add(current);

      const node = this.state.board.cards.find((c) => c.id === current);
      if (node) {
        for (const dep of node.dependencies) {
          if (!visited.has(dep)) {
            queue.push(dep);
          }
        }
      }
    }

    return false;
  }
}
