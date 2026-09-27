import { Router } from 'express';
import { searchController } from '../controllers/searchController';

const router = Router();

router.get('/', searchController.searchCandidates);

export default router;
