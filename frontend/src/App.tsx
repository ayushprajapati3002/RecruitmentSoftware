import { useState, useEffect, useRef } from 'react';
import { Search, Plus, Mail, Phone, Briefcase, X, UploadCloud, MessageSquare, FileText, Calendar, MapPin, Link, Globe, Clock, Edit2, Check, LayoutGrid, List as ListIcon } from 'lucide-react';

const STAGE_ORDER = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired'];
const API_BASE = import.meta.env.VITE_API_URL || '';

export default function App() {
  const [activeFilter, setActiveFilter] = useState('All Candidates');
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [selectedCandidate, setSelectedCandidate] = useState<any>(null);
  const [isNewFormOpen, setIsNewFormOpen] = useState(false);
  const [validated, setValidated] = useState(false);
  const [isSubmittingCandidate, setIsSubmittingCandidate] = useState(false);
  
  // Next Stage Modal State
  const [nextStagePopupCandidate, setNextStagePopupCandidate] = useState<any>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackError, setFeedbackError] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  // Resume Viewer State
  const [viewingResumeUrl, setViewingResumeUrl] = useState<string | null>(null);
  const [viewingResumeName, setViewingResumeName] = useState<string>("");

  // Edit Mode State
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [editFormData, setEditFormData] = useState<any>({});
  const [isSavingDetails, setIsSavingDetails] = useState(false);

  // Search State
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [searchMessage, setSearchMessage] = useState("");
  const [searchExplanation, setSearchExplanation] = useState("");
  const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
  const [searchType, setSearchType] = useState<'idle' | 'loading' | 'results' | 'no_matches' | 'invalid_query'>('idle');
  const [searchDebounceTimer, setSearchDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestId = useRef<number>(0);

  const filters = [
    'All Candidates',
    'Applied',
    'Screening',
    'Interview',
    'Offer',
    'Hired',
    'Rejected'
  ];

  // State-driven candidates (starts empty, fetched from DB)
  const [candidates, setCandidates] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchCandidates = async () => {
    try {
      setIsLoading(true);
      const res = await fetch(`${API_BASE}/api/candidates`);
      const data = await res.json();
      if (data.success) {
        setCandidates(data.data.map((c: any) => ({
          ...c,
          stage: c.currentStage,
          history: c.history ? c.history.map((h: any) => {
            
            return {
              title: h.action === 'create' ? 'First Applied' : (h.action === 'reject' ? 'Moved to Rejected' : `Moved to ${h.toStage}`),
              date: new Date(h.createdAt).toLocaleString(),
              rawDate: h.createdAt,
              feedback: h.notes
            };
          }).reverse().map((evt: any, i: number, arr: any[]) => {
            const nextEvent = arr[i + 1];
            const endTime = nextEvent ? new Date(nextEvent.rawDate).getTime() : Date.now();
            const startTime = new Date(evt.rawDate).getTime();
            const days = Math.floor((endTime - startTime) / (1000 * 60 * 60 * 24));
            return { ...evt, daysInStage: days };
          }).reverse() : []
        })));
      }
    } catch (err) {
      console.error("Failed to fetch candidates:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCandidates();
  }, []);


  const handleAddCandidate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (form.checkValidity() === false) {
      setValidated(true);
      return;
    }
    
    const formData = new FormData(form);
    
    // Add processed name
    formData.set('name', `${formData.get('firstName')} ${formData.get('middleName') || ''} ${formData.get('lastName')}`.replace(/\s+/g, ' ').trim());
    formData.delete('firstName');
    formData.delete('middleName');
    formData.delete('lastName');
    
    setIsSubmittingCandidate(true);
    
    try {
      const res = await fetch(`${API_BASE}/api/candidates`, {
        method: 'POST',
        // IMPORTANT: Let browser set multipart/form-data with boundary
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        setIsNewFormOpen(false);
        setValidated(false);
        setSelectedFileName(null);
        const newCandidate = {
          ...data.data,
          stage: data.data.currentStage,
          history: [{
            title: 'First Applied',
            date: new Date(data.data.createdAt || Date.now()).toLocaleString(),
            rawDate: data.data.createdAt || new Date().toISOString(),
            feedback: 'Candidate added to pipeline',
            daysInStage: 0
          }]
        };
        setCandidates(prev => [newCandidate, ...prev]);
        
        // Re-fetch in the background to ensure consistency
        fetchCandidates();
      } else {
        alert("Failed to save: " + data.error);
      }
    } catch (err) {
      console.error(err);
      alert("Network error. Make sure the backend is running.");
    } finally {
      setIsSubmittingCandidate(false);
    }
  };

  const handleStageChange = async (candidateId: number, newStage: string) => {
    const wordCount = feedbackText.trim().split(/\s+/).filter(word => word.length > 0).length;
    if (wordCount < 10) {
      setFeedbackError(true);
      return;
    }

    try {
      const endpoint = newStage === 'Rejected' 
        ? `${API_BASE}/api/candidates/${candidateId}/reject` 
        : `${API_BASE}/api/candidates/${candidateId}/advance`;
      
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: feedbackText })
      });
      
      const data = await res.json();
      if (data.success) {
        await fetchCandidates();
        setNextStagePopupCandidate(null);
        if (selectedCandidate && selectedCandidate.id === candidateId) {
          // Update the open modal candidate to reflect new history
          setSelectedCandidate(null); // or re-fetch specific candidate
        }
      } else {
        alert("Failed to update: " + data.error);
      }
    } catch (err) {
      console.error(err);
      alert("Network error.");
    }
  };

  const saveCandidateDetails = async () => {
    try {
      setIsSavingDetails(true);
      const res = await fetch(`${API_BASE}/api/candidates/${selectedCandidate.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editFormData,
          skills: Array.isArray(editFormData.skills) ? editFormData.skills.join(', ') : editFormData.skills
        })
      });
      const data = await res.json();
      if (data.success) {
        setIsEditingDetails(false);
        await fetchCandidates();
        // Update selected candidate immediately from the API response
        const fullRes = await fetch(`${API_BASE}/api/candidates/${selectedCandidate.id}`);
        const fullData = await fullRes.json();
        if (fullData.success) {
          setSelectedCandidate({
            ...fullData.data.candidate,
            stage: fullData.data.candidate.currentStage,
            history: fullData.data.history ? fullData.data.history.map((h: any) => ({
              title: h.action === 'create' ? 'First Applied' : (h.action === 'reject' ? 'Moved to Rejected' : `Moved to ${h.toStage}`),
              date: new Date(h.createdAt).toLocaleString(),
              rawDate: h.createdAt,
              feedback: h.notes
            })).map((evt: any, i: number, arr: any[]) => {
              const nextEvent = arr[i + 1]; // history from findById is asc!
              const endTime = nextEvent ? new Date(nextEvent.rawDate).getTime() : Date.now();
              const startTime = new Date(evt.rawDate).getTime();
              const days = Math.floor((endTime - startTime) / (1000 * 60 * 60 * 24));
              return { ...evt, daysInStage: days };
            }).reverse() : []
          });
        }
      } else {
        alert(data.error || 'Failed to update candidate');
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsSavingDetails(false);
    }
  };

  const openStagePopup = (candidate: any) => {
    setNextStagePopupCandidate(candidate);
    setFeedbackText("");
    setFeedbackError(false);
  };

  const getStageStyle = (stage: string) => {
    if (stage === 'Rejected') {
      return { backgroundColor: '#fee2e2', color: '#dc2626' };
    }
    
    switch (stage) {
      case 'Applied':
        return { backgroundColor: '#ecfdf5', color: '#059669' };
      case 'Screening':
        return { backgroundColor: '#d1fae5', color: '#047857' };
      case 'Interview':
        return { backgroundColor: '#a7f3d0', color: '#065f46' };
      case 'Offer':
        return { backgroundColor: '#6ee7b7', color: '#064e3b' };
      case 'Hired':
        return { backgroundColor: '#10b981', color: '#ffffff' };
      default:
        return { backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#059669' };
    }
  };

  const STAGE_SORT_ORDER: Record<string, number> = {
    'Hired': 1,
    'Offer': 2,
    'Interview': 3,
    'Screening': 4,
    'Applied': 5,
    'Rejected': 6
  };

  // ─── SMART SEARCH FUNCTIONS ──────────────────────────────────────────────

  const performSearch = async (query: string, stage: string) => {
    if (query.trim().length < 2) {
      setSearchType('idle'); setSearchResults(null);
      setSearchMessage(''); setSearchExplanation('');
      setSearchSuggestions([]);
      return;
    }
    
    searchRequestId.current += 1;
    const currentRequestId = searchRequestId.current;

    setSearchType('loading');
    try {
      const stageParam = stage !== 'All Candidates' ? `&stage=${encodeURIComponent(stage)}` : '';
      const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query.trim())}${stageParam}`);
      const data = await res.json();
      
      // If a newer search started while we were waiting, drop this response
      if (searchRequestId.current !== currentRequestId) return;

      if (!res.ok || data.type === 'invalid_query') {
        setSearchType('invalid_query'); setSearchResults(null);
        setSearchMessage(data.error || data.message || '');
        setSearchExplanation(data.explanation || '');
        setSearchSuggestions(data.suggestions || []);
        return;
      }
      if (data.type === 'no_matches') {
        setSearchType('no_matches'); setSearchResults([]);
        setSearchMessage(data.message || '');
        setSearchExplanation(data.explanation || '');
        setSearchSuggestions(data.suggestions || []);
        return;
      }
      // Map snake_case API fields to camelCase frontend fields
      const transformed = (data.data || []).map((c: any) => ({
        ...c,
        stage: c.current_stage || c.currentStage,
        currentStage: c.current_stage || c.currentStage,
        resumeUrl: c.resume_url || c.resumeUrl,
        createdAt: c.created_at || c.createdAt,
        relevanceScore: c.relevance_score,
        matchReason: c.match_reason,
        skills: c.skills || [],
        history: c.history ? c.history.map((h: any) => ({
          title: h.action === 'create' ? 'First Applied' : (h.action === 'reject' ? 'Moved to Rejected' : `Moved to ${h.toStage}`),
          date: new Date(h.createdAt).toLocaleString(),
          rawDate: h.createdAt,
          feedback: h.notes
        })).reverse().map((evt: any, i: number, arr: any[]) => {
          const nextEvent = arr[i + 1];
          const endTime = nextEvent ? new Date(nextEvent.rawDate).getTime() : Date.now();
          const startTime = new Date(evt.rawDate).getTime();
          const days = Math.floor((endTime - startTime) / (1000 * 60 * 60 * 24));
          return { ...evt, daysInStage: days };
        }).reverse() : [],
      }));
      setSearchType('results'); setSearchResults(transformed);
      setSearchMessage(''); setSearchSuggestions([]);
      setSearchExplanation(data.explanation || '');

    } catch (err) {
      console.error('Search API error:', err);
      setSearchType('invalid_query'); setSearchResults(null);
      setSearchMessage('Search service is unavailable. Try again.');
      setSearchExplanation(''); setSearchSuggestions([]);
    }
  };

  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    if (value.trim().length < 2) {
      setSearchType('idle'); setSearchResults(null);
      setSearchMessage(''); setSearchExplanation('');
      setSearchSuggestions([]);
      return;
    }
    const timer = setTimeout(() => performSearch(value, activeFilter), 800);
    setSearchDebounceTimer(timer);
  };

  const clearSearch = () => {
    setSearchQuery(''); setSearchType('idle'); setSearchResults(null);
    setSearchMessage(''); setSearchExplanation('');
    setSearchSuggestions([]);
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  };

  const handleFilterChange = (filter: string) => {
    setActiveFilter(filter);
    if (searchQuery.trim().length >= 2) {
      performSearch(searchQuery, filter);
    }
  };

  // ─── DISPLAYED CANDIDATES (API results or local filter) ──────────────────

  const displayedCandidates = (() => {
    // API search results (already sorted by relevance)
    if (searchType === 'results' && searchResults !== null) return searchResults;
    // No matches or error — empty list
    if (searchType === 'no_matches' || searchType === 'invalid_query') return [];
    // Default: local stage filter (idle state)
    return candidates
      .filter(c => activeFilter === 'All Candidates' || c.stage === activeFilter)
      .sort((a, b) => {
        if (activeFilter === 'All Candidates') {
          const wA = STAGE_SORT_ORDER[a.stage] || 99;
          const wB = STAGE_SORT_ORDER[b.stage] || 99;
          if (wA !== wB) return wA - wB;
        }
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  })();

  return (
    <div className="app-container">
      {/* Sidebar Filters */}
      <aside className="sidebar">
        <div className="brand">
          <div style={{ width: '32px', height: '32px', backgroundColor: 'var(--accent-black)', borderRadius: '8px', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>R</div>
          RecruitSoftware
        </div>
        
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Stages
        </div>
        
        <ul className="nav-links">
          {filters.map(filter => {
            const count = filter === 'All Candidates' 
              ? candidates.length 
              : candidates.filter(c => c.stage === filter).length;
              
            return (
              <li 
                key={filter}
                className={`nav-link ${activeFilter === filter ? 'active' : ''}`} 
                onClick={() => handleFilterChange(filter)}
              >
                <span>{filter}</span>
                <span style={{ opacity: 0.7, fontSize: '12px' }}>{count}</span>
              </li>
            );
          })}
        </ul>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        <header className="header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <h1 className="header-title" style={{ margin: 0 }}>{activeFilter}</h1>
            <div className="view-toggle" style={{ display: 'flex', background: 'var(--bg-secondary)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <button 
                type="button"
                className={`btn-icon ${viewMode === 'list' ? 'active-view' : ''}`}
                style={{ 
                  display: 'flex', alignItems: 'center', gap: '6px', border: 'none', background: viewMode === 'list' ? 'white' : 'transparent', 
                  padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)',
                  boxShadow: viewMode === 'list' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' 
                }}
                onClick={() => setViewMode('list')}
                title="List View"
              >
                <ListIcon size={14} /> List
              </button>
              <button 
                type="button"
                className={`btn-icon ${viewMode === 'kanban' ? 'active-view' : ''}`}
                style={{ 
                  display: 'flex', alignItems: 'center', gap: '6px', border: 'none', background: viewMode === 'kanban' ? 'white' : 'transparent', 
                  padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)',
                  boxShadow: viewMode === 'kanban' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' 
                }}
                onClick={() => setViewMode('kanban')}
                title="Stage Board View"
              >
                <LayoutGrid size={14} /> Board
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '16px', flex: 1, marginLeft: '24px' }}>
            <div className="search-bar" style={{ position: 'relative' }}>
              <Search size={18} color="var(--text-secondary)" />
              <input 
                type="text" 
                className="search-input" 
                placeholder='Type Any Question with Question Mark' 
                style={{ fontSize: '15px', padding: '6px 12px' }} 
                value={searchQuery}
                onChange={(e) => handleSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') clearSearch();
                  if (e.key === 'Enter' && searchQuery.trim().length >= 2) {
                    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
                    performSearch(searchQuery, activeFilter);
                  }
                }}
              />
              {searchQuery && (
                <button onClick={clearSearch} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }}>
                  <X size={16} />
                </button>
              )}
              {searchType === 'loading' && <div className="search-spinner" />}
            </div>
            <button className="btn-black" style={{ whiteSpace: 'nowrap', padding: '10px 24px' }} onClick={() => setIsNewFormOpen(true)}>
              <Plus size={16} /> New Candidate
            </button>
          </div>
        </header>

        <div className="content-area">
          {/* ─── SEARCH FEEDBACK PANEL ─────────────────────────────────────── */}
          {searchType !== 'idle' && searchType !== 'loading' && searchQuery.trim().length >= 2 && (
            <div className="search-feedback">
              {/* What the AI understood */}
              {searchExplanation && (
                <div className="search-explanation">
                  🧠 {searchExplanation}
                </div>
              )}

              {/* Result count */}
              {searchType === 'results' && searchResults && (
                <div className="search-result-count">
                  Found <strong>{searchResults.length}</strong> candidate{searchResults.length !== 1 ? 's' : ''}
                </div>
              )}

              {/* No matches — yellow warning */}
              {searchType === 'no_matches' && (
                <div className="search-no-matches">
                  <span>🔍</span>
                  <span>{searchMessage}</span>
                </div>
              )}

              {/* Invalid query — red error */}
              {searchType === 'invalid_query' && (
                <div className="search-error">
                  <span>⚠️</span>
                  <span>{searchMessage}</span>
                </div>
              )}

              {/* Smart clickable suggestions from Gemini */}
              {searchSuggestions.length > 0 && (
                <div className="search-suggestions">
                  <span className="suggestions-label">Try:</span>
                  {searchSuggestions.map((s, i) => (
                    <button
                      key={i}
                      className="suggestion-chip"
                      onClick={() => { setSearchQuery(s); performSearch(s, activeFilter); }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {viewMode === 'kanban' ? (
            /* ─── KANBAN BOARD VIEW ─────────────────────────────────────── */
            <div className="kanban-board-container" style={{ display: 'flex', gap: '16px', overflowX: 'auto', paddingBottom: '20px' }}>
              {['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected'].map(stageCol => {
                const stageCandidates = displayedCandidates.filter(c => c.stage === stageCol);
                const isRejected = stageCol === 'Rejected';
                const isHired = stageCol === 'Hired';

                return (
                  <div 
                    key={stageCol} 
                    className="kanban-column"
                    style={{
                      flex: '0 0 280px',
                      background: 'var(--bg-secondary)',
                      borderRadius: '12px',
                      padding: '14px',
                      display: 'flex',
                      flexDirection: 'column',
                      maxHeight: 'calc(100vh - 180px)',
                      border: '1px solid var(--border-color)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', paddingBottom: '8px', borderBottom: '1px solid var(--border-color)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>{stageCol}</span>
                        <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '10px', background: isRejected ? '#fee2e2' : (isHired ? '#d1fae5' : '#e5e7eb'), color: isRejected ? '#dc2626' : (isHired ? '#047857' : '#4b5563') }}>
                          {stageCandidates.length}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto', flex: 1, paddingRight: '4px' }}>
                      {stageCandidates.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '32px 10px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                          No candidates
                        </div>
                      ) : (
                        stageCandidates.map(c => (
                          <div 
                            key={c.id} 
                            className="kanban-card"
                            style={{
                              background: 'white',
                              borderRadius: '8px',
                              padding: '14px',
                              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                              border: '1px solid var(--border-color)',
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '8px'
                            }}
                            onClick={() => setSelectedCandidate(c)}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</h4>
                              {c.experience && (
                                <span style={{ fontSize: '11px', color: '#059669', background: 'rgba(16, 185, 129, 0.1)', padding: '2px 6px', borderRadius: '6px', fontWeight: 600 }}>
                                  {c.experience}y
                                </span>
                              )}
                            </div>

                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                              {c.vacancy}
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                              <Clock size={12} />
                              <span>{c.history?.[0]?.daysInStage === 0 ? '< 1 day' : `${c.history?.[0]?.daysInStage || 0} days`} in stage</span>
                            </div>

                            {c.skills && c.skills.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                                {c.skills.slice(0, 2).map((s: string) => (
                                  <span key={s} style={{ fontSize: '10px', background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px', color: 'var(--text-secondary)' }}>
                                    {s}
                                  </span>
                                ))}
                                {c.skills.length > 2 && (
                                  <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>+{c.skills.length - 2}</span>
                                )}
                              </div>
                            )}

                            {!isHired && !isRejected && (
                              <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end' }}>
                                <button
                                  className="btn-black"
                                  style={{ padding: '4px 10px', fontSize: '11px', borderRadius: '6px' }}
                                  onClick={(e) => { e.stopPropagation(); openStagePopup(c); }}
                                >
                                  Next Stage
                                </button>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* ─── LIST VIEW ─────────────────────────────────────────────── */
            <div className="candidate-list">
              {isLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '100px 0', width: '100%' }}>
                  <div className="spinner"></div>
                  <div style={{ marginTop: '16px', color: 'var(--text-secondary)', fontWeight: 500 }}>Fetching Candidates...</div>
                </div>
              ) : displayedCandidates.length === 0 ? (
                <div className="search-empty-state">
                  {searchType === 'no_matches' || searchType === 'invalid_query' ? (
                    <>
                      <Search size={48} color="var(--border-color)" style={{ marginBottom: '16px' }} />
                      <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-primary)' }}>
                        {searchType === 'invalid_query' ? "Couldn't understand that search" : 'No matching candidates'}
                      </div>
                      <div style={{ color: 'var(--text-secondary)', marginBottom: '20px', maxWidth: '400px' }}>
                        {searchMessage}
                      </div>
                      {searchSuggestions.length > 0 && (
                        <div className="search-suggestions" style={{ justifyContent: 'center' }}>
                          {searchSuggestions.map((s, i) => (
                            <button key={i} className="suggestion-chip" onClick={() => { setSearchQuery(s); performSearch(s, activeFilter); }}>{s}</button>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <FileText size={48} color="var(--border-color)" style={{ marginBottom: '16px' }} />
                      No candidates found in this stage.
                    </>
                  )}
                </div>
              ) : (
                displayedCandidates.map(candidate => (
                  <div key={candidate.id} className="list-card" style={{ padding: '24px 32px' }}>
                    <div className="card-header">
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px' }}>
                          <h2 className="card-title" onClick={() => setSelectedCandidate(candidate)} style={{ margin: 0 }}>
                            {candidate.name}
                          </h2>
                          <button 
                            className="btn-secondary" 
                            style={{ padding: '4px 10px', fontSize: '12px', display: 'flex', gap: '6px', alignItems: 'center', height: 'fit-content' }}
                            onClick={(e) => { 
                              e.stopPropagation(); 
                              if (candidate.resumeUrl) {
                                setViewingResumeName(candidate.name);
                                setViewingResumeUrl(candidate.resumeUrl);
                              } else {
                                alert("No resume uploaded for this candidate.");
                              }
                            }}
                          >
                            <FileText size={12} /> View Resume
                          </button>
                        </div>
                        <div className="card-vacancy" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                          Applied for: <span style={{ color: '#4b5563', fontWeight: 600 }}>{candidate.vacancy}</span>
                          <span style={{ fontSize: '13px', padding: '2px 8px', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderRadius: '12px', color: '#059669', fontWeight: 600 }}>
                            {candidate.experience} Years Exp.
                          </span>
                        </div>
                      </div>
                      <div>
                        <div className="card-stage-badge" style={{ padding: '8px 24px', fontSize: '13px', textAlign: 'center', minWidth: '130px', fontWeight: 600, ...getStageStyle(candidate.stage) }}>
                          {candidate.stage}
                        </div>
                      </div>
                    </div>

                    <div className="card-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '16px' }}>
                      <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap', maxWidth: '100%' }}>
                        <div className="card-section" style={{ minWidth: '220px', maxWidth: '240px' }}>
                          <div className="contact-item" style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}>
                            <Mail size={16} style={{ flexShrink: 0 }} /> 
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{candidate.email}</span>
                          </div>
                          <div className="contact-item" style={{ display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}>
                            <Phone size={16} style={{ flexShrink: 0 }} /> 
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{candidate.phone}</span>
                          </div>
                        </div>
                        
                        <div className="card-section" style={{ minWidth: '150px' }}>
                          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Top Skills
                          </div>
                          <div className="skills-list" style={{ gap: '6px' }}>
                            {candidate.skills.slice(0, 3).map((skill: string) => (
                              <span key={skill} className="skill-tag" style={{ padding: '4px 8px', fontSize: '11px' }}>{skill}</span>
                            ))}
                            {candidate.skills.length > 3 && <span className="skill-tag" style={{ padding: '4px 8px', fontSize: '11px' }}>+{candidate.skills.length - 3}</span>}
                          </div>
                        </div>

                        <div className="card-section" style={{ minWidth: '180px' }}>
                          <div className="contact-item" style={{ fontSize: '13px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}>
                            <Clock size={16} style={{ flexShrink: 0 }} /> 
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Last Update: {candidate.history[0]?.date?.split(',')[0] || 'N/A'}</span>
                          </div>
                          {candidate.linkedin && (
                            <a 
                              href={candidate.linkedin} 
                              target="_blank" 
                              rel="noreferrer" 
                              className="contact-item hover-link" 
                              style={{ fontSize: '13px', color: 'var(--text-secondary)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Link size={16} style={{ flexShrink: 0 }} /> 
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>LinkedIn Profile</span>
                            </a>
                          )}
                        </div>
                      </div>
                      
                      {/* Bottom Right Container for Action Buttons */}
                      <div>
                        {candidate.stage === 'Hired' && (
                          <div style={{ fontSize: '13px', fontWeight: 600, color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', padding: '8px 24px', borderRadius: 'var(--radius)', textAlign: 'center', minWidth: '130px' }}>
                            Welcome!
                          </div>
                        )}

                        {candidate.stage !== 'Hired' && candidate.stage !== 'Rejected' && (
                          <button 
                            className="btn-black" 
                            style={{ padding: '8px 24px', fontSize: '13px', fontWeight: 600, textAlign: 'center', minWidth: '130px', borderRadius: 'var(--radius)' }} 
                            onClick={(e) => { e.stopPropagation(); openStagePopup(candidate); }}
                          >
                            Next Stage
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </main>

      {/* Mini Next Stage Modal */}
      {nextStagePopupCandidate && (
        <div className="modal-overlay" onClick={() => setNextStagePopupCandidate(null)} style={{ zIndex: 2000 }}>
          <div className="modal-content" style={{ width: '460px', height: 'auto', padding: '24px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 600 }}>Update Stage</h3>
              <button className="close-btn" onClick={() => setNextStagePopupCandidate(null)}>
                <X size={18} />
              </button>
            </div>
            
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px' }}>
              Select the next step for <strong>{nextStagePopupCandidate.name}</strong>.
            </p>
            
            <div className="form-group" style={{ marginBottom: '24px' }}>
              <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Feedback / Reason <span className="required">*</span></span>
                {feedbackError && <span style={{ color: '#ef4444', fontSize: '12px' }}>Minimum 10 words required</span>}
              </label>
              <textarea 
                className="form-input" 
                rows={3} 
                placeholder="Enter feedback for this decision (min. 10 words)..." 
                value={feedbackText}
                onChange={(e) => {
                  setFeedbackText(e.target.value);
                  const wordCount = e.target.value.trim().split(/\s+/).filter(word => word.length > 0).length;
                  if (wordCount >= 10) setFeedbackError(false);
                }}
                style={{ borderColor: feedbackError ? '#ef4444' : '', backgroundColor: feedbackError ? 'rgba(239, 68, 68, 0.05)' : '' }}
              ></textarea>
            </div>
            
            <div style={{ display: 'flex', gap: '12px', flexDirection: 'column' }}>
              {(() => {
                const currentIndex = STAGE_ORDER.indexOf(nextStagePopupCandidate.stage);
                const nextStage = STAGE_ORDER[currentIndex + 1];
                return (
                  <button 
                    className="btn-primary" 
                    style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
                    onClick={() => handleStageChange(nextStagePopupCandidate.id, nextStage)}
                  >
                    Advance to {nextStage}
                  </button>
                )
              })()}
              <button 
                className="btn-danger" 
                style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
                onClick={() => handleStageChange(nextStagePopupCandidate.id, 'Rejected')}
              >
                Mark as Rejected
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal Popup */}
      {selectedCandidate && (
        <div className="modal-overlay" onClick={() => setSelectedCandidate(null)}>
          <div className="modal-content" style={{ width: '1000px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 style={{ fontSize: '20px', fontWeight: 600 }}>{selectedCandidate.name}</h2>
              <button className="close-btn" onClick={() => setSelectedCandidate(null)}>
                <X size={20} />
              </button>
            </div>
            
            <div className="modal-body">
              {/* Left Side: Details */}
              <div className="modal-left">
                <div className="detail-group">
                  <div className="detail-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Vacancy Applied
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {isEditingDetails ? (
                        <>
                          <button className="btn-secondary" style={{ padding: '4px 12px', fontSize: '12px', display: 'flex', gap: '6px', alignItems: 'center', color: '#ef4444' }} onClick={() => setIsEditingDetails(false)}>
                            <X size={14} /> Cancel
                          </button>
                          <button className="btn-primary" style={{ padding: '4px 12px', fontSize: '12px', display: 'flex', gap: '6px', alignItems: 'center' }} onClick={saveCandidateDetails} disabled={isSavingDetails}>
                            <Check size={14} /> {isSavingDetails ? 'Saving...' : 'Save'}
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="btn-secondary" style={{ padding: '4px 12px', fontSize: '12px', display: 'flex', gap: '6px', alignItems: 'center' }} onClick={() => { setIsEditingDetails(true); setEditFormData(selectedCandidate); }}>
                            <Edit2 size={14} /> Edit
                          </button>
                          <button className="btn-secondary" style={{ padding: '4px 12px', fontSize: '12px', display: 'flex', gap: '6px', alignItems: 'center' }} onClick={() => {
                            if (selectedCandidate.resumeUrl) {
                              setViewingResumeName(selectedCandidate.name);
                              setViewingResumeUrl(selectedCandidate.resumeUrl);
                            } else {
                              alert("No resume uploaded for this candidate.");
                            }
                          }}>
                            <FileText size={12} /> View Resume
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="detail-value" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                    <Briefcase size={16} color="var(--text-secondary)" /> 
                    {isEditingDetails ? (
                      <input type="text" className="form-input" style={{ padding: '4px 8px', flex: 1 }} value={editFormData.vacancy || ''} onChange={(e) => setEditFormData({...editFormData, vacancy: e.target.value})} />
                    ) : (
                      selectedCandidate.vacancy
                    )}
                  </div>
                </div>
                
                <div className="detail-group">
                  <div className="detail-label">Personal Information</div>
                  {isEditingDetails ? (
                    <div className="detail-value" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '13px', minWidth: '60px' }}>Name:</span>
                        <input type="text" className="form-input" style={{ padding: '4px 8px', flex: 1 }} value={editFormData.name || ''} onChange={(e) => setEditFormData({...editFormData, name: e.target.value})} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Calendar size={16} color="var(--text-secondary)" /> 
                        <input type="date" className="form-input" style={{ padding: '4px 8px', flex: 1 }} value={editFormData.dob || ''} onChange={(e) => setEditFormData({...editFormData, dob: e.target.value})} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <MapPin size={16} color="var(--text-secondary)" /> 
                        <input type="text" className="form-input" style={{ padding: '4px 8px', flex: 1 }} value={editFormData.address || ''} onChange={(e) => setEditFormData({...editFormData, address: e.target.value})} />
                      </div>
                    </div>
                  ) : (
                    <div className="detail-value" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Calendar size={16} color="var(--text-secondary)" /> {selectedCandidate.dob || 'Not provided'}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><MapPin size={16} color="var(--text-secondary)" /> {selectedCandidate.address || 'Not provided'}</span>
                    </div>
                  )}
                </div>

                <div className="detail-group">
                  <div className="detail-label">Contact Information</div>
                  {isEditingDetails ? (
                    <div className="detail-value" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Mail size={16} color="var(--text-secondary)" /> 
                        <input type="email" className="form-input" style={{ padding: '4px 8px', flex: 1 }} value={editFormData.email || ''} onChange={(e) => setEditFormData({...editFormData, email: e.target.value})} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Phone size={16} color="var(--text-secondary)" /> 
                        <input type="tel" className="form-input" style={{ padding: '4px 8px', flex: 1 }} value={editFormData.phone || ''} onChange={(e) => setEditFormData({...editFormData, phone: e.target.value})} />
                      </div>
                    </div>
                  ) : (
                    <div className="detail-value" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Mail size={16} color="var(--text-secondary)" /> {selectedCandidate.email}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Phone size={16} color="var(--text-secondary)" /> {selectedCandidate.phone}</span>
                    </div>
                  )}
                </div>
                
                <div className="detail-group">
                  <div className="detail-label">Professional Profiles</div>
                  {isEditingDetails ? (
                    <div className="detail-value" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Link size={16} color="var(--text-secondary)" /> 
                        <input type="url" placeholder="LinkedIn URL" className="form-input" style={{ padding: '4px 8px', flex: 1 }} value={editFormData.linkedin || ''} onChange={(e) => setEditFormData({...editFormData, linkedin: e.target.value})} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Globe size={16} color="var(--text-secondary)" /> 
                        <input type="url" placeholder="GitHub URL" className="form-input" style={{ padding: '4px 8px', flex: 1 }} value={editFormData.github || ''} onChange={(e) => setEditFormData({...editFormData, github: e.target.value})} />
                      </div>
                    </div>
                  ) : (
                    <div className="detail-value" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Link size={16} color="var(--text-secondary)" /> 
                        <a href={selectedCandidate.linkedin} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-black)', textDecoration: 'none' }}>{selectedCandidate.linkedin ? 'LinkedIn Profile' : 'Not provided'}</a>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Globe size={16} color="var(--text-secondary)" /> 
                        {selectedCandidate.github ? (
                          <a href={selectedCandidate.github} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-black)', textDecoration: 'none' }}>GitHub Profile</a>
                        ) : (
                          <span style={{ color: 'var(--text-secondary)' }}>Not provided</span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
                
                <div className="detail-group">
                  <div className="detail-label">Experience</div>
                  {isEditingDetails ? (
                    <div className="detail-value" style={{ fontSize: '14px', lineHeight: '1.5' }}>
                      <input type="number" className="form-input" style={{ padding: '4px 8px', width: '100px' }} value={editFormData.experience || ''} onChange={(e) => setEditFormData({...editFormData, experience: e.target.value})} />
                    </div>
                  ) : (
                    <div className="detail-value" style={{ fontSize: '14px', lineHeight: '1.5' }}>
                      {selectedCandidate.experience ? `${selectedCandidate.experience} Years` : 'Not provided'}
                    </div>
                  )}
                </div>

                <div className="detail-group">
                  <div className="detail-label">Skills & Technologies</div>
                  {isEditingDetails ? (
                    <div className="skills-list" style={{ marginTop: '8px' }}>
                      <input type="text" placeholder="Comma separated skills" className="form-input" style={{ padding: '4px 8px', width: '100%' }} value={Array.isArray(editFormData.skills) ? editFormData.skills.join(', ') : editFormData.skills} onChange={(e) => setEditFormData({...editFormData, skills: e.target.value})} />
                    </div>
                  ) : (
                    <div className="skills-list" style={{ marginTop: '8px' }}>
                      {selectedCandidate.skills.map((skill: string) => (
                        <span key={skill} className="skill-tag">{skill}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Side: Timeline */}
              <div className="modal-right">
                <div className="detail-label" style={{ marginBottom: '32px' }}>Candidate Journey</div>
                <div className="timeline" style={{ position: 'relative', marginTop: '16px' }}>
                  
                  {/* End Point Marker (if terminal stage) */}
                  {(selectedCandidate.stage === 'Rejected' || selectedCandidate.stage === 'Hired') && (
                    <div style={{ position: 'relative', left: '-22px', fontSize: '11px', fontWeight: 700, color: 'white', background: selectedCandidate.stage === 'Rejected' ? '#ef4444' : '#10b981', padding: '4px 12px', borderRadius: '16px', zIndex: 2, width: 'fit-content', marginBottom: '16px' }}>
                      END
                    </div>
                  )}

                  {/* Bottom-Up Rendering (Newest at top) */}
                  {selectedCandidate.history.map((evt: any, i: number) => {
                    const isLatest = i === 0;
                    const isRejected = isLatest && selectedCandidate.stage === 'Rejected';
                    
                    const dotColor = isRejected ? '#ef4444' : (isLatest ? '#10b981' : 'var(--accent-black)');
                    const dotBorder = isRejected ? '#fecaca' : (isLatest ? '#d1fae5' : 'var(--bg-secondary)');
                    const contentBorder = isRejected ? '#ef4444' : (isLatest ? '#10b981' : 'var(--border-color)');
                    const titleColor = isRejected ? '#ef4444' : (isLatest ? '#10b981' : 'var(--text-primary)');
                    const shadow = isRejected ? '0 4px 12px rgba(239, 68, 68, 0.1)' : (isLatest ? '0 4px 12px rgba(16, 185, 129, 0.1)' : 'none');

                    return (
                      <div key={i} className="timeline-item">
                        <div 
                          className="timeline-dot" 
                          style={{ backgroundColor: dotColor, borderColor: dotBorder, zIndex: 2 }}
                        ></div>
                        <div 
                          className="timeline-content" 
                          style={{ borderColor: contentBorder, boxShadow: shadow }}
                        >
                          <div className="timeline-title" style={{ color: titleColor }}>{evt.title}</div>
                          <div className="timeline-date" style={{ marginBottom: evt.feedback ? '8px' : '0' }}>
                            {evt.date} • <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{evt.daysInStage === 0 ? '< 1 day' : `${evt.daysInStage} days`}</span> in stage
                          </div>
                          {evt.feedback && (
                            <div style={{ fontSize: '13px', backgroundColor: 'var(--bg-secondary)', padding: '8px 12px', borderRadius: '6px', borderLeft: '3px solid var(--accent-black)', marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                              <MessageSquare size={14} style={{ marginTop: '2px', opacity: 0.6 }} />
                              <span>{evt.feedback}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Start Point Marker */}
                  <div style={{ position: 'relative', left: '-22px', fontSize: '11px', fontWeight: 700, color: 'white', background: '#10b981', padding: '4px 12px', borderRadius: '16px', zIndex: 2, width: 'fit-content', marginTop: '16px' }}>
                    START
                  </div>
                  
                  {/* End Point Indicator line extending below the last item */}
                  <div style={{ position: 'absolute', bottom: '0', left: '5px', width: '4px', height: '30px', background: 'linear-gradient(to bottom, transparent 0%, var(--bg-secondary) 100%)', zIndex: 1, pointerEvents: 'none' }}></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Candidate Form Modal */}
      {isNewFormOpen && (
        <div className="modal-overlay" onClick={() => setIsNewFormOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: '700px', height: 'auto', maxHeight: '90vh' }}>
            <div className="modal-header">
              <h2 style={{ fontSize: '20px', fontWeight: 600 }}>New Candidate Application</h2>
              <button className="close-btn" onClick={() => { setIsNewFormOpen(false); setSelectedFileName(null); }}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'block', overflowY: 'auto', padding: '24px' }}>
              <form className={`candidate-form ${validated ? 'was-validated' : ''}`} onSubmit={handleAddCandidate} noValidate>
                
                <div className="form-group">
                  <label className="form-label">Upload Resume <span className="required">*</span></label>
                  <div className="file-upload-box">
                     <input type="file" name="resume" required className="file-input" onChange={(e) => {
                       if (e.target.files && e.target.files[0]) {
                         setSelectedFileName(e.target.files[0].name);
                       }
                     }} />
                     <div className="upload-placeholder">
                       {selectedFileName ? (
                         <div style={{ color: 'var(--accent-black)', fontWeight: 600 }}>
                           <FileText size={32} style={{ margin: '0 auto 8px auto', display: 'block' }} />
                           {selectedFileName}
                         </div>
                       ) : (
                         <>
                           <UploadCloud size={32} color="var(--text-secondary)" style={{ margin: '0 auto 8px auto', display: 'block' }} />
                           Drag & Drop or Click to Upload PDF/DOCX
                         </>
                       )}
                     </div>
                  </div>
                  {validated && !selectedFileName && (
                    <div style={{ color: 'var(--danger)', fontSize: '12px', marginTop: '8px', fontWeight: 500 }}>
                      Please upload a resume to proceed.
                    </div>
                  )}
                </div>
                
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">First Name <span className="required">*</span></label>
                    <input type="text" name="firstName" pattern="[A-Za-z\s]+" title="Only letters and spaces allowed" className="form-input" required placeholder="John" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Middle Name</label>
                    <input type="text" name="middleName" pattern="[A-Za-z\s]+" title="Only letters and spaces allowed" className="form-input" placeholder="A" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Last Name <span className="required">*</span></label>
                    <input type="text" name="lastName" pattern="[A-Za-z\s]+" title="Only letters and spaces allowed" className="form-input" required placeholder="Doe" />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Date of Birth <span className="required">*</span></label>
                    <input type="date" name="dob" className="form-input" required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Applied for Vacancy <span className="required">*</span></label>
                    <input type="text" name="vacancy" pattern="[A-Za-z\s\-]+" title="Only letters, spaces, and hyphens allowed" className="form-input" required placeholder="e.g. Senior Frontend Engineer" />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Phone Number <span className="required">*</span></label>
                    <input type="tel" name="phone" pattern="[\+0-9\-\s\(\)]+" title="Valid phone number format (e.g. +1 234-567-890)" className="form-input" required placeholder="+1 234 567 890" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Email ID <span className="required">*</span></label>
                    <input type="email" name="email" className="form-input" required placeholder="john@example.com" />
                  </div>
                </div>
                
                <div className="form-group">
                  <label className="form-label">Address <span className="required">*</span></label>
                  <input type="text" name="address" className="form-input" required placeholder="123 Main St, City, Country" />
                </div>

                <div className="form-group">
                  <label className="form-label">Skills <span className="required">*</span></label>
                  <input type="text" name="skills" className="form-input" required placeholder="e.g. React, TypeScript, CSS (comma separated)" />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">LinkedIn Profile <span className="required">*</span></label>
                    <input type="url" name="linkedin" className="form-input" required placeholder="https://linkedin.com/in/..." />
                  </div>
                  <div className="form-group">
                    <label className="form-label">GitHub Profile</label>
                    <input type="url" name="github" className="form-input" placeholder="https://github.com/..." />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Experience (Years) <span className="required">*</span></label>
                  <input type="number" name="experience" min="0" className="form-input" required placeholder="e.g. 5" />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '32px' }}>
                   <button type="button" className="btn-danger" onClick={() => { setIsNewFormOpen(false); setValidated(false); setSelectedFileName(null); }} disabled={isSubmittingCandidate}>Cancel</button>
                   <button type="submit" className="btn-primary" onClick={() => setValidated(true)} disabled={isSubmittingCandidate}>{isSubmittingCandidate ? 'Saving...' : 'Save Candidate'}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Resume Viewer Modal */}
      {viewingResumeUrl && (
        <div className="modal-overlay" onClick={() => setViewingResumeUrl(null)} style={{ zIndex: 3000 }}>
          <div className="modal-content" style={{ width: '90vw', maxWidth: '1200px', height: '90vh', padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header" style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileText size={20} color="var(--accent-black)" /> {viewingResumeName}'s CV
              </h2>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <button 
                  className="btn-secondary" 
                  style={{ padding: '6px 12px', fontSize: '12px' }}
                  onClick={() => window.open(viewingResumeUrl, "_blank")}
                >
                  Open in New Tab
                </button>
                <button className="close-btn" onClick={() => setViewingResumeUrl(null)}>
                  <X size={20} />
                </button>
              </div>
            </div>
            <div style={{ flex: 1, width: '100%', backgroundColor: '#525659' }}>
              <iframe 
                src={`${viewingResumeUrl?.startsWith('http') ? viewingResumeUrl : API_BASE + viewingResumeUrl}#toolbar=0`}
                width="100%" 
                height="100%" 
                style={{ border: 'none' }}
                title={`${viewingResumeName}'s CV`}
              />
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
