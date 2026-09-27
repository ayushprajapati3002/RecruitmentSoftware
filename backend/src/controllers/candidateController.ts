import { Request, Response } from 'express';
import { CandidateModel } from '../models/Candidate';
import { PipelineService } from '../services/pipelineService';

export const candidateController = {
  async createCandidate(req: Request, res: Response) {
    try {
      const skillsStr = req.body.skills || '';
      const skillsArr = typeof skillsStr === 'string' 
        ? skillsStr.split(',').map((s: string) => s.trim()).filter(Boolean) 
        : skillsStr;
      
      if (!req.body.vacancy || req.body.vacancy.trim() === '') {
        return res.status(400).json({ success: false, error: 'Vacancy is required.' });
      }

      const candidateData = {
        name: req.body.name,
        email: req.body.email,
        phone: req.body.phone,
        dob: req.body.dob,
        address: req.body.address,
        linkedin: req.body.linkedin,
        github: req.body.github,
        experience: req.body.experience,
        skills: skillsArr,
        vacancy: req.body.vacancy,
        resumeUrl: req.file ? `/uploads/${req.file.filename}` : undefined
      };
      
      const candidate = await PipelineService.addCandidate(candidateData);
      res.status(201).json({ success: true, data: candidate });
    } catch (error: any) {
      if (error.message === 'DUPLICATE_EMAIL') {
        res.status(409).json({ success: false, error: 'A candidate with this email already exists.' });
      } else {
        res.status(400).json({ success: false, error: error.message });
      }
    }
  },

  async getAllCandidates(req: Request, res: Response) {
    try {
      const stage = req.query.stage as string | undefined;
      const candidates = await CandidateModel.findAll(stage);
      res.json({ success: true, data: candidates });
    } catch (error: any) {
      res.status(500).json({ success: false, error: 'Failed to fetch candidates' });
    }
  },

  async getCandidateById(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid ID' });

      const data = await CandidateModel.findById(id);
      if (!data) return res.status(404).json({ success: false, error: 'Candidate not found' });

      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: 'Failed to fetch candidate details' });
    }
  },

  async updateCandidate(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid ID' });

      let skillsArr = undefined;
      if (req.body.skills !== undefined) {
        const skillsStr = req.body.skills || '';
        skillsArr = typeof skillsStr === 'string' 
          ? skillsStr.split(',').map((s: string) => s.trim()).filter(Boolean) 
          : skillsStr;
      }

      const updateData: any = { ...req.body };
      if (skillsArr !== undefined) {
        updateData.skills = skillsArr;
      }
      
      const candidate = await CandidateModel.updateDetails(id, updateData);
      res.json({ success: true, data: candidate });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  },

  async advanceCandidate(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid ID' });

      const candidate = await PipelineService.advanceCandidate(id, req.body.feedback);
      res.json({ success: true, data: candidate });
    } catch (error: any) {
      if (error.message === 'NOT_FOUND') return res.status(404).json({ success: false, error: 'Candidate not found' });
      if (error.message === 'ARCHIVED') return res.status(400).json({ success: false, error: 'Cannot advance archived candidate' });
      res.status(400).json({ success: false, error: error.message });
    }
  },

  async rejectCandidate(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid ID' });

      const candidate = await PipelineService.rejectCandidate(id, req.body.feedback);
      res.json({ success: true, data: candidate });
    } catch (error: any) {
      if (error.message === 'NOT_FOUND') return res.status(404).json({ success: false, error: 'Candidate not found' });
      if (error.message === 'ARCHIVED') return res.status(400).json({ success: false, error: 'Cannot reject archived candidate' });
      res.status(400).json({ success: false, error: error.message });
    }
  },

  async archiveCandidate(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);
      if (isNaN(id)) return res.status(400).json({ success: false, error: 'Invalid ID' });

      const candidate = await PipelineService.archiveCandidate(id);
      res.json({ success: true, data: candidate });
    } catch (error: any) {
      if (error.message === 'NOT_FOUND') return res.status(404).json({ success: false, error: 'Candidate not found' });
      res.status(400).json({ success: false, error: error.message });
    }
  },
};
