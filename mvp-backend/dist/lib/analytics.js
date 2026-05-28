const metricKeys = ['stressLeader', 'performance', 'relationship', 'stressJunior'];
const pluralityAmongOthers = (votes, excludePlayerId) => {
    const counts = new Map();
    for (const vote of votes) {
        if (vote.playerId === excludePlayerId || !vote.optionId)
            continue;
        const optionId = vote.optionId;
        counts.set(optionId, (counts.get(optionId) ?? 0) + 1);
    }
    if (counts.size === 0)
        return null;
    let bestOption = null;
    let bestCount = -1;
    for (const [optionId, count] of counts) {
        if (count > bestCount) {
            bestCount = count;
            bestOption = optionId;
        }
        else if (count === bestCount && bestOption !== null && optionId.localeCompare(bestOption) < 0) {
            bestOption = optionId;
        }
    }
    return bestOption;
};
const shareMatchingLeader = (round) => {
    const votes = round.playerVotes ?? [];
    if (votes.length === 0)
        return { share: null, overHalf: null };
    const leaderChoice = round.leaderChoice;
    if (leaderChoice == null)
        return { share: null, overHalf: null };
    const voters = votes.filter((v) => v.role !== 'SPECTATOR' && v.optionId);
    if (voters.length === 0)
        return { share: null, overHalf: null };
    const matching = voters.filter((v) => v.optionId === leaderChoice).length;
    const share = matching / voters.length;
    return { share, overHalf: share > 0.5 };
};
export const buildGameAnalytics = (game) => {
    const rounds = game.roundHistory ?? [];
    const totalRounds = rounds.length;
    const alignmentCorrectCount = rounds.filter((round) => round.isAligned).length;
    const alignmentPct = totalRounds > 0 ? (alignmentCorrectCount / totalRounds) * 100 : null;
    const outcomeSuccess = totalRounds > 0 ? alignmentCorrectCount >= Math.ceil(totalRounds / 2) : false;
    const leader = game.players.find((player) => player.role === 'LEADER') ?? null;
    const participantNames = game.players
        .filter((player) => player.role === 'PARTICIPANT')
        .map((player) => player.username);
    const nonLeaderPlayers = game.players
        .filter((player) => player.role !== 'LEADER' && player.role !== 'SPECTATOR')
        .map((player) => {
        if (totalRounds === 0) {
            return {
                playerId: player.id,
                username: player.username,
                role: player.role,
                pctRoundsMatchingLeader: null,
                pctRoundsMatchingOthersMajority: null
            };
        }
        let leaderMatches = 0;
        let majorityMatches = 0;
        let roundsWithMajority = 0;
        for (const round of rounds) {
            const votes = round.playerVotes ?? [];
            if (votes.length === 0)
                continue;
            const mine = votes.find((v) => v.playerId === player.id)?.optionId ?? null;
            if (round.leaderChoice && mine === round.leaderChoice)
                leaderMatches += 1;
            const maj = pluralityAmongOthers(votes, player.id);
            if (maj != null) {
                roundsWithMajority += 1;
                if (mine === maj)
                    majorityMatches += 1;
            }
        }
        return {
            playerId: player.id,
            username: player.username,
            role: player.role,
            pctRoundsMatchingLeader: (leaderMatches / totalRounds) * 100,
            pctRoundsMatchingOthersMajority: roundsWithMajority > 0 ? (majorityMatches / roundsWithMajority) * 100 : null
        };
    });
    const situations = rounds.map((round, index) => {
        const { share, overHalf } = shareMatchingLeader(round);
        return {
            situationIndex: index + 1,
            situationId: round.situationId,
            situationTitle: round.situationTitle || round.situationId,
            alignmentCorrect: round.isAligned,
            shareMatchingLeader: share != null ? Math.round(share * 1000) / 10 : null,
            overHalfPlayersMatchedLeader: overHalf
        };
    });
    const initialMetrics = { ...game.initialMetrics };
    const finalMetrics = { ...game.finalMetrics };
    for (const key of metricKeys) {
        if (typeof initialMetrics[key] !== 'number')
            initialMetrics[key] = 0;
        if (typeof finalMetrics[key] !== 'number')
            finalMetrics[key] = 0;
    }
    return {
        gameId: game.id,
        roomCode: game.roomCode,
        finishedAt: game.finishedAt,
        leaderName: leader?.username ?? null,
        participantNames,
        totalRounds,
        alignmentCorrectCount,
        alignmentPct: alignmentPct != null ? Math.round(alignmentPct * 10) / 10 : null,
        outcomeSuccess,
        initialMetrics,
        finalMetrics,
        nonLeaderPlayers,
        situations
    };
};
export const formatMetricsLine = (label, metrics) => {
    return metricKeys.map((key) => `${label[key]}: ${metrics[key]}`).join(' | ');
};
