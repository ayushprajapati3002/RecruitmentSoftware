import { Request, Response } from 'express';
import { search } from '../services/searchService';

export const searchController = {
  async searchCandidates(req: Request, res: Response) {
    try {
      const query = req.query.q as string;
      const stage = req.query.stage as string | undefined;

      if (!query) {
        return res.status(400).json({
          success: false,
          type: 'invalid_query',
          error: 'Missing search query.',
          explanation: 'No search query was provided.',
          suggestions: [],
        });
      }

      const result = await search(query, stage);

      if (result.type === 'invalid_query') {
        return res.status(400).json({
          success: false,
          type: 'invalid_query',
          error: result.message,
          explanation: result.explanation || '',
          suggestions: result.suggestions || [],
          queryParsed: result.queryParsed || null,
        });
      }

      if (result.type === 'no_matches') {
        return res.status(200).json({
          success: true,
          type: 'no_matches',
          data: [],
          message: result.message,
          explanation: result.explanation || '',
          suggestions: result.suggestions || [],
          queryParsed: result.queryParsed || null,
        });
      }

      res.status(200).json({
        success: true,
        type: 'results',
        data: result.results,
        explanation: result.explanation || '',
        queryParsed: result.queryParsed || null,
      });
    } catch (error: any) {
      console.error('Search error:', error);
      res.status(500).json({
        success: false,
        error: 'An internal error occurred during search.',
      });
    }
  },
};
