import { Router } from 'express';
import { botTokenAuth } from '../middleware/auth';
import { apiLimiter } from '../middleware/rateLimiter';
import { withTenantContext } from '../middleware/tenantContext';

export const apiRouter = Router();

apiRouter.use('/api', apiLimiter);

apiRouter.get('/api/workspaces/:id/salary-tiers', botTokenAuth, async (req, res) => {
  const workspaceId = req.params.id as string;
  const tiers = await withTenantContext(workspaceId, async (tx) => {
    return tx.salaryTier.findMany();
  });
  res.json(tiers);
});

apiRouter.post('/api/workspaces/:id/salary-tiers', botTokenAuth, async (req, res) => {
  const workspaceId = req.params.id as string;
  const { roleName, annualSalary } = req.body;
  
  if (!roleName || !annualSalary) {
    res.status(400).json({ error: 'roleName and annualSalary numerical values strictly required.' });
    return;
  }

  const tier = await withTenantContext(workspaceId, async (tx) => {
    return tx.salaryTier.create({
      data: {
        workspaceId,
        roleName: roleName,
        annualSalary: Number(annualSalary)
      }
    });
  });

  res.status(201).json(tier);
});

apiRouter.delete('/api/workspaces/:id/salary-tiers/:tierId', botTokenAuth, async (req, res) => {
  const workspaceId = req.params.id as string;
  const tierId = req.params.tierId as string;
  
  await withTenantContext(workspaceId, async (tx) => {
    await tx.salaryTier.deleteMany({ 
       where: { id: tierId, workspaceId }
    });
  });
  res.status(204).send();
});
