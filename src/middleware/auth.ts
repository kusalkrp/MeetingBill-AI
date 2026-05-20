import { Request, Response, NextFunction } from 'express';
import { prisma } from '../db/prisma';
import { decrypt } from '../utils/encryption';
import { logger } from '../utils/logger';

export const botTokenAuth = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const workspaceId = (req.params.id || req.params.workspaceId) as string;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing standard strict Bearer token signature validation headers' });
    return;
  }
  
  if (!workspaceId) {
    res.status(400).json({ error: 'Missing explicit UUID workspace assignment boundaries' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace || !workspace.botToken) {
      res.status(401).json({ error: 'Unrecognized execution bounding box payload parameters' });
      return;
    }

    const decrypted = decrypt(workspace.botToken);
    if (decrypted !== token) {
      res.status(401).json({ error: 'Unauthorized key decoding sequence mapping mismatch' });
      return;
    }
    
    next();
  } catch (err) {
    logger.error({ err }, 'BotToken Auth Layer Failed safely');
    res.status(401).json({ error: 'Invalid corrupted validation strings' });
  }
};
