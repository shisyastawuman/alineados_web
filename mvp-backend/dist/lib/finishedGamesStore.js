import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
const finishedGamesPath = path.join(process.cwd(), 'finished-games.json');
const readFile = () => {
    if (!fs.existsSync(finishedGamesPath)) {
        return { games: [] };
    }
    const raw = fs.readFileSync(finishedGamesPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.games || !Array.isArray(parsed.games))
        return { games: [] };
    return parsed;
};
const writeFile = (data) => {
    fs.writeFileSync(finishedGamesPath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
};
export const appendFinishedGame = (record) => {
    const full = {
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
export const listGamesForAdmin = (adminId) => {
    return readFile().games.filter((game) => game.adminId === adminId);
};
export const getGameById = (gameId) => {
    return readFile().games.find((game) => game.id === gameId) ?? null;
};
