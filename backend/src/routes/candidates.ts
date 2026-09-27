import { Router } from 'express';
import { candidateController } from '../controllers/candidateController';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Resolve uploads folder relative to project root or cwd
const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'));
  }
});
const upload = multer({ storage: storage });

const router = Router();

router.post('/', upload.single('resume'), candidateController.createCandidate);
router.get('/', candidateController.getAllCandidates);
router.get('/:id', candidateController.getCandidateById);
router.put('/:id', candidateController.updateCandidate);

router.post('/:id/advance', candidateController.advanceCandidate);
router.post('/:id/reject', candidateController.rejectCandidate);
router.post('/:id/archive', candidateController.archiveCandidate); // Soft delete

export default router;
