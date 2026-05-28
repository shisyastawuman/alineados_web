import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { FinishedGameRecord } from './gameTypes.js';

const finishedGamesPath = path.join(process.cwd(), 'finished-games.json');

interface FileShape {
  games: FinishedGameRecord[];
}

const readFile = (): FileShape => {
  if (!fs.existsSync(finishedGamesPath)) {
    return { games: [] };
  }
  const raw = fs.readFileSync(finishedGamesPath, 'utf-8');
  const parsed = JSON.parse(raw) as FileShape;
  if (!parsed.games || !Array.isArray(parsed.games)) return { games: [] };
  return parsed;
};

const writeFile = (data: FileShape): void => {
  fs.writeFileSync(finishedGamesPath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
};

export const appendFinishedGame = (record: Omit<FinishedGameRecord, 'id' | 'finishedAt'> & { id?: string; finishedAt?: string }): FinishedGameRecord => {
  const full: FinishedGameRecord = {
    id: record.id ?? crypto.randomUUID(),
    finishedAt: record.finishedAt ?? new Date().toISOString(),
    roomCode: record.roomCode,
    adminId: record.adminId,
    players: record.players,
    initialMetrics: record.initialMetrics,
    finalMetrics: record.finalMetrics,
    alignmentHits: record.alignmentHits,
    roundHistory: record.roundHistory
  };

  const data = readFile();
  data.games.unshift(full);
  writeFile(data);
  return full;
};

export const listGamesForAdmin = (adminId: string): FinishedGameRecord[] => {
  return readFile().games.filter((game) => game.adminId === adminId);
};

export const getGameById = (gameId: string): FinishedGameRecord | null => {
  return readFile().games.find((game) => game.id === gameId) ?? null;
};
