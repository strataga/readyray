'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';

type Workspace = { id: string; name: string; createdAt: string };
type Digest = { path: string; algorithm: 'sha256'; hexDigest: string; byteSize: number };
type AcceptedArchive = { intakeId: string; status: 'accepted'; workspaceId: string; archiveSha256: string; sourceCommitSha?: string; digests: Digest[] };
type ReviewCitation = { path: string; startLine: number; endLine: number; sha256: string };
type ReviewFinding = { id: string; classification: 'fact' | 'inference' | 'assumption' | 'insufficient_evidence'; title: string; description: string; citations: ReviewCitation[]; status: 'proposed' | 'approved' | 'rejected' | 'published'; reviewerId?: string; decidedAt?: string };
type ReviewerReview = { id: string; workspaceId: string; evidenceIntakeId: string; sourceCommitSha?: string; createdAt: string; status: 'draft' | 'published'; publishedAt?: string; version: number; findings: ReviewFinding[] };
type Finding = { id: string; title: string; severity: 'High' | 'Medium' | 'Low'; kind: 'Fact' | 'Inference' | 'Assumption' | 'Insufficient evidence'; summary: string; path: string; line: number; confidence: number; decision: 'Open' | 'Accepted' | 'Dismissed' };

const sampleFindings: Finding[] = [
  { id: 'F-014', title: 'No documented recovery objective', severity: 'High', kind: 'Fact', summary: 'The deployment guide describes a backup schedule, but does not define a recovery time or recovery point objective.', path: 'docs/operations/backup.md', line: 42, confidence: 96, decision: 'Open' },
  { id: 'F-009', title: 'Single-region dependency', severity: 'Medium', kind: 'Inference', summary: 'The infrastructure configuration references one primary region. A regional outage may interrupt service unless failover is managed elsewhere.', path: 'infra/production.tf', line: 18, confidence: 83, decision: 'Open' },
  { id: 'F-006', title: 'Health check omits database readiness', severity: 'Medium', kind: 'Fact', summary: 'The readiness endpoint verifies process health. No database dependency check is visible in this configuration.', path: 'apps/api/src/health.ts', line: 11, confidence: 91, decision: 'Open' },
  { id: 'F-002', title: 'No evidence for key rotation cadence', severity: 'Low', kind: 'Insufficient evidence', summary: 'The reviewed materials do not establish how frequently production keys are rotated.', path: 'docs/security/controls.md', line: 0, confidence: 61, decision: 'Open' },
];

const apiProblem = async (response: Response) => {
  const body = await response.json().catch(() => ({})) as { detail?: string; title?: string };
  return body.detail ?? body.title ?? 'Something went wrong. Please try again.';
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const };
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    chevron: <><path d="m9 18 6-6-6-6"/></>,
    down: <><path d="m7 10 5 5 5-5"/></>,
    upload: <><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 15.5v3A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-3"/></>,
    code: <><path d="m8 8-4 4 4 4M16 8l4 4-4 4m-2-11-4 14"/></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></>,
    check: <><path d="m5 12 4 4L19 6"/></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/></>,
    download: <><path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5"/><path d="M4 20h16"/></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    github: <><path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 6v-3.9a3.4 3.4 0 0 0-.9-2.7c3-.3 6.2-1.5 6.2-6.8a5.3 5.3 0 0 0-1.4-3.7 4.9 4.9 0 0 0-.1-3.7S17.7.9 15 2.8a13.2 13.2 0 0 0-7 0C5.3.9 3.2 1.2 3.2 1.2a4.9 4.9 0 0 0-.1 3.7 5.3 5.3 0 0 0-1.4 3.7c0 5.3 3.2 6.5 6.2 6.8a3.4 3.4 0 0 0-.9 2.7V22"/></>,
    spark: <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/></>,
  };
  return <svg {...common}>{paths[name] ?? paths.grid}</svg>;
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}><span className="brand-mark"><span/><span/><span/></span><span className="brand-name">archgauge</span></div>;
}

export default function Home() {
  const [auth, setAuth] = useState<'loading' | 'signed-out' | 'signed-in'>('loading');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [registerMode, setRegisterMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [activePage, setActivePage] = useState<'overview' | 'new' | 'findings' | 'reports'>('overview');
  const [source, setSource] = useState<'zip' | 'github'>('zip');
  const [selectedFile, setSelectedFile] = useState<File | undefined>();
  const [githubUrl, setGithubUrl] = useState('');
  const [archive, setArchive] = useState<AcceptedArchive | undefined>();
  const [activeReview, setActiveReview] = useState<ReviewerReview | undefined>();
  const [uploadProgress, setUploadProgress] = useState<'idle' | 'uploading' | 'accepted'>('idle');
  const [findings, setFindings] = useState(sampleFindings);
  const [filter, setFilter] = useState<'All' | Finding['severity']>('All');
  const [citation, setCitation] = useState<Finding | undefined>();
  const fileRef = useRef<HTMLInputElement>(null);
  const workspaceModalRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let mounted = true;
    fetch('/api/auth/session', { cache: 'no-store' }).then(async (response) => {
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { detail?: string };
        throw new Error(body.detail ?? 'ArchGauge could not verify your session. Please retry shortly.');
      }
      return response.json() as Promise<{ authenticated: boolean; sessionExpired?: boolean; workspaces: Workspace[] }>;
    }).then((result) => {
      if (!mounted) {return;}
      setAuth(result.authenticated ? 'signed-in' : 'signed-out');
      if (result.sessionExpired) {setError('Your session expired. Sign in again to continue.');}
      setWorkspaces(result.workspaces);
      setWorkspaceId(result.workspaces[0]?.id ?? '');
      if (result.authenticated && result.workspaces[0]) {void loadWorkspaceReviews(result.workspaces[0].id);}
    }).catch(() => {
      if (mounted) {
        setAuth('signed-out');
        setError('ArchGauge could not verify your session. Check the API connection and try again.');
      }
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!creatingWorkspace) {return;}
    const dialog = workspaceModalRef.current;
    if (!dialog) {return;}
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCreatingWorkspace(false);
        return;
      }
      if (event.key !== 'Tab') {return;}
      const items = focusable();
      if (items.length === 0) {return;}
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [creatingWorkspace]);

  const activeWorkspace = workspaces.find((item) => item.id === workspaceId);
  const visibleFindings = useMemo(() => findings.filter((finding) => filter === 'All' || finding.severity === filter), [filter, findings]);
  const openCount = activeReview ? activeReview.findings.filter((finding) => finding.status === 'proposed').length : findings.filter((finding) => finding.decision === 'Open').length;

  function selectWorkspace(nextWorkspaceId: string) {
    if (nextWorkspaceId !== workspaceId) {
      setArchive(undefined);
      setActiveReview(undefined);
      setSelectedFile(undefined);
      setUploadProgress('idle');
    }
    setWorkspaceId(nextWorkspaceId);
    if (nextWorkspaceId) {void loadWorkspaceReviews(nextWorkspaceId);}
  }

  async function loadWorkspaceReviews(nextWorkspaceId: string) {
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(nextWorkspaceId)}/reviews`, { cache: 'no-store' });
      if (!response.ok) {throw new Error(await apiProblem(response));}
      const reviews = await response.json() as ReviewerReview[];
      const review = reviews[0];
      setActiveReview(review);
      if (!review) {setArchive(undefined); return;}
      const inventoryResponse = await fetch(`/api/workspaces/${encodeURIComponent(nextWorkspaceId)}/evidence/archives/${encodeURIComponent(review.evidenceIntakeId)}`, { cache: 'no-store' });
      if (!inventoryResponse.ok) {throw new Error(await apiProblem(inventoryResponse));}
      const inventory = await inventoryResponse.json() as { intakeId: string; status: 'accepted'; workspaceId: string; archiveSha256: string; digests: Digest[] };
      setArchive({ ...inventory, sourceCommitSha: review.sourceCommitSha });
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Workspace reviews could not be loaded.');
    }
  }

  async function createReview(accepted: AcceptedArchive): Promise<ReviewerReview> {
    const response = await fetch(`/api/workspaces/${encodeURIComponent(accepted.workspaceId)}/reviews`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ evidenceIntakeId: accepted.intakeId, ...(accepted.sourceCommitSha ? { sourceCommitSha: accepted.sourceCommitSha } : {}) }),
    });
    if (!response.ok) {throw new Error(await apiProblem(response));}
    return await response.json() as ReviewerReview;
  }

  async function beginAcceptedReview(accepted: AcceptedArchive) {
    setArchive(accepted);
    setUploadProgress('accepted');
    try {
      const review = await createReview(accepted);
      setActiveReview(review);
      setActivePage('findings');
      setError('');
    } catch (exception) {
      setError(`Evidence was accepted, but the review draft could not be created: ${exception instanceof Error ? exception.message : 'try again.'}`);
      setActivePage('overview');
    }
  }

  async function decideReviewFinding(findingId: string, decision: 'approve' | 'reject') {
    if (!activeReview) {return;}
    const response = await fetch(`/api/workspaces/${encodeURIComponent(activeReview.workspaceId)}/reviews/${encodeURIComponent(activeReview.id)}/findings/${encodeURIComponent(findingId)}/decision`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision }),
    });
    if (!response.ok) {throw new Error(await apiProblem(response));}
    setActiveReview(await response.json() as ReviewerReview);
  }

  async function addReviewFinding(input: { classification: ReviewFinding['classification']; title: string; description: string; citations: ReviewCitation[] }) {
    if (!activeReview) {return;}
    const response = await fetch(`/api/workspaces/${encodeURIComponent(activeReview.workspaceId)}/reviews/${encodeURIComponent(activeReview.id)}/findings`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    });
    if (!response.ok) {throw new Error(await apiProblem(response));}
    setActiveReview(await response.json() as ReviewerReview);
  }

  async function publishActiveReview() {
    if (!activeReview) {return;}
    const response = await fetch(`/api/workspaces/${encodeURIComponent(activeReview.workspaceId)}/reviews/${encodeURIComponent(activeReview.id)}/publish`, { method: 'POST' });
    if (!response.ok) {throw new Error(await apiProblem(response));}
    setActiveReview(await response.json() as ReviewerReview);
  }

  async function exportActiveReview(format: 'json' | 'html' | 'markdown') {
    if (!activeReview) {return;}
    const response = await fetch(`/api/workspaces/${encodeURIComponent(activeReview.workspaceId)}/reviews/${encodeURIComponent(activeReview.id)}/export?format=${format}`);
    if (!response.ok) {throw new Error(await apiProblem(response));}
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `archgauge-review-${activeReview.id}.${format === 'markdown' ? 'md' : format}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (registerMode) {
        const registered = await fetch('/api/auth/register', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
        });
        if (!registered.ok) {throw new Error(await apiProblem(registered));}
      }
      const response = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {throw new Error(await apiProblem(response));}
      setPassword('');
      const session = await fetch('/api/auth/session');
      const result = await session.json() as { workspaces: Workspace[] };
      setWorkspaces(result.workspaces);
      setWorkspaceId(result.workspaces[0]?.id ?? '');
      setAuth('signed-in');
      if (result.workspaces[0]) {await loadWorkspaceReviews(result.workspaces[0].id);}
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Sign in could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  async function createWorkspace(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!workspaceName.trim()) {return;}
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/workspaces', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: workspaceName }),
      });
      if (!response.ok) {throw new Error(await apiProblem(response));}
      const created = await response.json() as Workspace;
      setWorkspaces((items) => [...items, created]);
      setWorkspaceId(created.id);
      setActiveReview(undefined);
      setArchive(undefined);
      setWorkspaceName('');
      setCreatingWorkspace(false);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Workspace could not be created.');
    } finally {
      setBusy(false);
    }
  }

  async function uploadArchive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!workspaceId || !selectedFile) {return;}
    if (!selectedFile.name.toLowerCase().endsWith('.zip')) {
      setError('Choose a .zip archive to continue.');
      return;
    }
    if (selectedFile.size > 50 * 1024 * 1024) {
      setError('This archive is larger than the 50 MB upload limit.');
      return;
    }
    setBusy(true);
    setUploadProgress('uploading');
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/evidence/archives`, {
        method: 'POST', headers: { 'content-type': 'application/zip' }, body: selectedFile,
      });
      if (!response.ok) {throw new Error(await apiProblem(response));}
      const accepted = await response.json() as AcceptedArchive;
      await beginAcceptedReview(accepted);
      setSelectedFile(undefined);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'The archive could not be uploaded.');
      setUploadProgress('idle');
    } finally {
      setBusy(false);
    }
  }

  async function ingestGithub(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!workspaceId) {return;}
    setBusy(true);
    setUploadProgress('uploading');
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/evidence/github`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repositoryUrl: githubUrl.trim() }),
      });
      if (!response.ok) {throw new Error(await apiProblem(response));}
      const accepted = await response.json() as AcceptedArchive;
      await beginAcceptedReview(accepted);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'The public repository could not be imported.');
      setUploadProgress('idle');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) {
        throw new Error(await apiProblem(response));
      }
      setAuth('signed-out');
      setWorkspaces([]);
      setWorkspaceId('');
      setArchive(undefined);
      setActiveReview(undefined);
      setUploadProgress('idle');
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : 'Your session could not be revoked. Please try again.');
    }
  }

  function decide(id: string, decision: Finding['decision']) {
    setFindings((items) => items.map((finding) => finding.id === id ? { ...finding, decision } : finding));
  }

  function exportReport(format: 'json' | 'md' | 'html') {
    const markdown = `# ADR: Example architecture review\n\n> Preview only. This example contains sample findings, not analysis results for your repository.\n\n## Status\n\nProposed\n\n## Context\n\nThis preview demonstrates how cited review findings and reviewer decisions can be shared. No review engine is connected.\n\n## Evidence reviewed\n\nNo repository evidence is attached to this example.\n\n## Findings and decisions\n\n${findings.map((finding) => `### ${finding.id}: ${finding.title}\n\n- **Severity:** ${finding.severity}\n- **Evidence type:** ${finding.kind}\n- **Reviewer decision:** ${finding.decision}\n- **Citation:** \`${finding.path}${finding.line ? `:${finding.line}` : ''}\`\n\n${finding.summary}\n`).join('\n')}\n## Consequences\n\nThis preview is illustrative and must not be treated as an assessment.\n`;
    const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Example architecture review</title><style>body{max-width:760px;margin:48px auto;padding:0 24px;font:16px/1.65 system-ui,sans-serif;color:#17231f}h1,h2{font-family:system-ui,sans-serif;line-height:1.2}header,aside{padding:16px;background:#f2f7f1;border-radius:8px}article{padding:18px 0;border-bottom:1px solid #e2e9e4}code{color:#286c52}small{color:#65736b}</style><header><strong>ARCHGAUGE · EXAMPLE REVIEW</strong><h1>Example architecture review</h1><p>Sample findings only — not an assessment of your repository.</p></header>${findings.map((finding) => `<article><small>${escapeHtml(finding.id)} · ${escapeHtml(finding.severity)} · ${escapeHtml(finding.kind)}</small><h2>${escapeHtml(finding.title)}</h2><p>${escapeHtml(finding.summary)}</p><p><code>${escapeHtml(finding.path)}${finding.line ? `:${finding.line}` : ''}</code></p><p>Decision: ${escapeHtml(finding.decision)}</p></article>`).join('')}<aside>Illustrative preview. The review analysis service is not connected.</aside></html>`;
    const content = format === 'json'
      ? JSON.stringify({ title: 'Example architecture review', status: 'preview', findings }, null, 2)
      : format === 'html' ? html : markdown;
    const mime = format === 'json' ? 'application/json' : format === 'html' ? 'text/html' : 'text/markdown';
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `archgauge-example-review.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (auth === 'loading') {
    return <main className="auth-loading"><Brand/><span className="loading-dot"/>Loading your workspace…</main>;
  }

  if (auth === 'signed-out') {
    return (
      <main className="auth-shell">
        <div className="auth-brand"><Brand/><span className="auth-tagline">Evidence before opinion.</span></div>
        <section className="auth-card" aria-labelledby="auth-heading">
          <div className="eyebrow"><span className="eyebrow-dot"/> REVIEW WORKSPACE</div>
          <h1 id="auth-heading">{registerMode ? 'Create your account' : 'Welcome back'}</h1>
          <p className="auth-intro">{registerMode ? 'Start a clear, evidence-first architecture review.' : 'Pick up where your team left off.'}</p>
          <form onSubmit={authenticate} className="auth-form">
            <label htmlFor="email">Work email</label>
            <input id="email" type="email" autoComplete="email" maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" />
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete={registerMode ? 'new-password' : 'current-password'} minLength={registerMode ? 12 : 1} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder={registerMode ? 'At least 12 characters' : 'Your password'} />
            {error && <p className="error-banner" role="alert">{error}</p>}
            <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'One moment…' : registerMode ? 'Create account' : 'Sign in'}<Icon name="chevron" size={16}/></button>
          </form>
          <div className="auth-switch">{registerMode ? 'Already have an account?' : 'New to ArchGauge?'} <button onClick={() => { setRegisterMode(!registerMode); setError(''); }}>{registerMode ? 'Sign in' : 'Create account'}</button></div>
          <div className="secure-note"><Icon name="lock" size={14}/> Your session stays in a secure, HTTP-only cookie.</div>
        </section>
        <div className="auth-foot"><span>ARCHITECTURE REVIEW, WITH RECEIPTS</span><span>PRIVATE BY DESIGN <span className="foot-star">✳</span></span></div>
      </main>
    );
  }

  const navItems = [
    { id: 'overview', label: 'Overview', icon: 'grid' },
    { id: 'new', label: 'New review', icon: 'plus' },
    { id: 'findings', label: 'Findings', icon: 'shield', count: openCount },
    { id: 'reports', label: 'Reports', icon: 'file' },
  ] as const;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-top"><Brand/></div>
        <div className="workspace-picker-wrap">
          <label className="sidebar-label" htmlFor="workspace-select">WORKSPACE</label>
          <div className="workspace-picker"><span className="workspace-avatar">{activeWorkspace?.name.slice(0, 1).toUpperCase() ?? 'A'}</span><select id="workspace-select" value={workspaceId} onChange={(event) => selectWorkspace(event.target.value)} aria-label="Select workspace"><option value="">Choose a workspace</option>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select><Icon name="down" size={14}/></div>
          <button className="new-workspace-link" onClick={() => setCreatingWorkspace(true)}><Icon name="plus" size={15}/> Create workspace</button>
        </div>
        <nav className="side-nav" aria-label="Workspace navigation">
          <span className="sidebar-label">REVIEW</span>
          {navItems.map((item) => <button key={item.id} className={`nav-item ${activePage === item.id ? 'active' : ''}`} onClick={() => setActivePage(item.id)}><Icon name={item.icon}/><span>{item.label}</span>{'count' in item && item.count > 0 && <span className="nav-count">{item.count}</span>}</button>)}
        </nav>
        <div className="sidebar-spacer"/>
        <div className="sidebar-foot-card"><div className="mini-orbit"><span/><span/><span/></div><strong>Evidence-led, always.</strong><p>Every finding links back to a source you can verify.</p></div>
        <div className="user-row"><span className="user-avatar">{email.trim().slice(0, 1).toUpperCase() || 'R'}</span><div className="user-copy"><strong>{email || 'Reviewer'}</strong><span>Reviewer</span></div><button className="icon-button logout-button" onClick={signOut} aria-label="Sign out"><Icon name="logout" size={17}/></button></div>
      </aside>

      <section className="main-panel">
        <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><Icon name="chevron" size={14}/><strong>{activePage === 'new' ? 'New review' : activePage === 'findings' ? 'Findings' : activePage === 'reports' ? 'Reports' : 'Overview'}</strong></div><div className="topbar-right"><span className="live-indicator"><i/> API CONNECTED</span><label className="mobile-workspace-picker"><span className="visually-hidden">Select workspace</span><select value={workspaceId} onChange={(event) => selectWorkspace(event.target.value)} aria-label="Select workspace"><option value="">Choose workspace</option>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label><button className="icon-button mobile-create-workspace" onClick={() => setCreatingWorkspace(true)} aria-label="Create workspace"><Icon name="plus"/></button><span className="avatar-small" aria-hidden="true">{email.trim().slice(0, 1).toUpperCase() || 'R'}</span></div></header>
        <div className="content-wrap">
          {error && <div className="error-banner global-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}

          {activePage === 'overview' && <>
            <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> YOUR REVIEW DESK</div><h1>{activeWorkspace ? `Good to have you, ${activeWorkspace.name}.` : 'Your review desk.'}</h1><p>Make architecture decisions with evidence you can point to.</p></div><button className="button button-primary" onClick={() => { setActivePage('new'); setError(''); }}><Icon name="plus" size={17}/> Start a review</button></div>
            {!activeWorkspace && <section className="empty-workspace surface-card"><span className="empty-icon"><Icon name="grid" size={22}/></span><div><h2>Set up your first workspace</h2><p>Keep review evidence, findings, and decisions together with your team.</p></div><button className="button button-secondary" onClick={() => setCreatingWorkspace(true)}>Create workspace <Icon name="chevron" size={15}/></button></section>}
            <section className="stat-grid" aria-label="Review summary"><div className="stat-card"><div className="stat-top"><span>OPEN FINDINGS</span><span className="stat-icon gold"><Icon name="shield" size={17}/></span></div><strong>{findings.filter((finding) => finding.decision === 'Open').length.toString().padStart(2, '0')}</strong><span className="stat-note">Across your review desk</span><div className="stat-spark gold-spark"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div></div><div className="stat-card"><div className="stat-top"><span>REVIEWS THIS MONTH</span><span className="stat-icon mint"><Icon name="search" size={17}/></span></div><strong>{archive ? '01' : '00'}</strong><span className="stat-note">Evidence-first and repeatable</span><div className="stat-spark mint-spark"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div></div><div className="stat-card"><div className="stat-top"><span>EVIDENCE FILES</span><span className="stat-icon blue"><Icon name="file" size={17}/></span></div><strong>{archive?.digests.length.toString().padStart(2, '0') ?? '00'}</strong><span className="stat-note">Validated and digest-pinned</span><div className="stat-spark blue-spark"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div></div></section>

            <section className="work-grid"><div className="surface-card recent-card"><div className="card-heading"><div><span className="section-kicker">IN PROGRESS</span><h2>Recent reviews</h2></div><button className="text-link" onClick={() => setActivePage('reports')}>View all <Icon name="chevron" size={14}/></button></div>
              {archive ? <div className="review-row"><span className="review-source-icon"><Icon name="file"/></span><div className="review-main"><strong>{selectedFile?.name ?? 'Evidence archive review'}</strong><span>{new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} <i/> {archive.digests.length} files inventoried</span></div><span className="status-pill status-accepted"><i/> Evidence accepted</span><button className="icon-button row-arrow" onClick={() => setActivePage('findings')} aria-label="Open review"><Icon name="chevron"/></button></div> : <div className="recent-empty"><span className="empty-orbit"><Icon name="spark" size={20}/></span><strong>No reviews yet</strong><span>Start with a ZIP archive and get your evidence in order.</span><button className="text-link" onClick={() => setActivePage('new')}>Start your first review <Icon name="chevron" size={14}/></button></div>}
              {archive && <div className="review-note"><Icon name="clock" size={15}/> Review analysis becomes available when the review service is connected.</div>}
            </div><div className="surface-card quick-card"><div className="card-heading"><div><span className="section-kicker">GET STARTED</span><h2>Bring your evidence</h2></div><span className="quick-spark"><Icon name="spark"/></span></div><button className="quick-action" onClick={() => { setSource('zip'); setActivePage('new'); }}><span className="quick-icon zip"><Icon name="upload"/></span><span><strong>Upload a ZIP archive</strong><small>Bounded intake, scanned before storage</small></span><Icon name="chevron" size={16}/></button><button className="quick-action" onClick={() => { setSource('github'); setActivePage('new'); }}><span className="quick-icon repo"><Icon name="github"/></span><span><strong>Review a public repository</strong><small>Connect a public GitHub URL</small></span><Icon name="chevron" size={16}/></button><div className="quick-foot"><Icon name="lock" size={14}/> Submitted code is never executed.</div></div></section>

            <section className="bottom-grid"><div className="surface-card priority-card"><div className="card-heading"><div><span className="section-kicker">NEEDS YOUR EYE</span><h2>Top finding</h2></div><span className="severity severity-high">HIGH PRIORITY</span></div><div className="top-finding"><div className="finding-number">F-014</div><div><h3>No documented recovery objective</h3><p>Backup procedures are described, but a recovery time or point objective is not visible in the evidence.</p><button className="citation-link" onClick={() => setActivePage('findings')}><Icon name="file" size={14}/> docs/operations/backup.md:42 <Icon name="chevron" size={13}/></button></div></div></div><div className="surface-card standard-card"><span className="section-kicker">A CLEARER SIGNAL</span><div className="standard-content"><span className="standard-art"><i/><i/><i/><i/><i/><i/><i/><i/><i/></span><div><h3>Facts stay separate<br/>from assumptions.</h3><p>Every finding carries a type, a confidence, and a citation to review.</p></div></div></div></section>
            <p className="preview-disclaimer"><Icon name="spark" size={14}/> Example findings shown until analysis is connected. They are not results for your repository.</p>
          </>}

          {activePage === 'new' && <>
            <div className="page-heading compact-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> REVIEW SETUP</div><h1>Start with the evidence.</h1><p>Choose a source. ArchGauge inventories it without running submitted code.</p></div><span className="step-count">STEP <strong>01</strong> <i/> 02</span></div>
            <section className="setup-layout"><div className="surface-card setup-card"><div className="source-tabs" role="tablist" aria-label="Evidence source"><button role="tab" aria-selected={source === 'zip'} className={source === 'zip' ? 'selected' : ''} onClick={() => { setSource('zip'); setError(''); }}><Icon name="upload" size={17}/> ZIP archive</button><button role="tab" aria-selected={source === 'github'} className={source === 'github' ? 'selected' : ''} onClick={() => { setSource('github'); setError(''); }}><Icon name="github" size={17}/> Public GitHub</button></div>
              {source === 'zip' ? <form onSubmit={uploadArchive}>
                <div className="setup-section-heading"><div><span className="section-kicker">UPLOAD SOURCE</span><h2>Select an archive</h2></div><span className="limit-badge">MAX 50 MB</span></div>
                <input ref={fileRef} className="visually-hidden" type="file" accept=".zip,application/zip" onChange={(event: ChangeEvent<HTMLInputElement>) => setSelectedFile(event.target.files?.[0])} aria-label="Choose ZIP archive"/>
                <button type="button" className={`dropzone ${selectedFile ? 'has-file' : ''}`} onClick={() => fileRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) {setSelectedFile(file);} }}>
                  <span className="drop-icon"><Icon name={selectedFile ? 'file' : 'upload'} size={21}/></span>
                  {selectedFile ? <><strong>{selectedFile.name}</strong><span>{(selectedFile.size / (1024 * 1024)).toFixed(1)} MB · Click to choose another file</span></> : <><strong>Drop your ZIP here, or <em>browse files</em></strong><span>ZIP format only · Up to 50 MB</span></>}
                </button>
                <div className="setup-section-heading source-details"><div><span className="section-kicker">REVIEW DETAILS</span><h2>Keep this review organized</h2></div></div>
                <label className="field-label" htmlFor="workspace-for-upload">Workspace</label>
                <select id="workspace-for-upload" className="text-input" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}><option value="">Choose a workspace</option>{workspaces.map((workspace) => <option value={workspace.id} key={workspace.id}>{workspace.name}</option>)}</select>
                <div className="privacy-callout"><span><Icon name="shield" size={17}/></span><p><strong>Safe by design</strong>Archive paths are validated and files are scanned for secrets before accepted evidence is stored. Repository code is never executed.</p></div>
                <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setActivePage('overview')}>Cancel</button><button className="button button-primary" disabled={busy || !workspaceId || !selectedFile}>{busy ? 'Uploading…' : 'Upload evidence'}<Icon name="chevron" size={15}/></button></div>
                {uploadProgress !== 'idle' && <div className="upload-steps" aria-live="polite"><span className="done"><i/><span>Archive selected</span></span><span className={uploadProgress === 'uploading' ? 'current' : uploadProgress === 'accepted' ? 'done' : ''}><i/><span>Secure upload</span></span><span className={uploadProgress === 'accepted' ? 'done' : ''}><i/><span>Evidence accepted</span></span></div>}
              </form> : <form className="github-panel" onSubmit={ingestGithub}>
                <span className="github-large"><Icon name="github" size={30}/></span><span className="section-kicker">PUBLIC REPOSITORY</span><h2>Bring a repository into review</h2><p>Import a public GitHub repository as a ZIP archive. Private repositories and credentials are not supported.</p>
                <label htmlFor="github-url" className="field-label">Repository URL</label><input id="github-url" className="text-input" value={githubUrl} onChange={(event) => setGithubUrl(event.target.value)} placeholder="https://github.com/org/repository" autoComplete="url"/>
                <label className="field-label" htmlFor="github-workspace">Workspace</label><select id="github-workspace" className="text-input" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}><option value="">Choose a workspace</option>{workspaces.map((workspace) => <option value={workspace.id} key={workspace.id}>{workspace.name}</option>)}</select>
                <div className="privacy-callout"><span><Icon name="shield" size={17}/></span><p><strong>Public repositories only</strong>ArchGauge fetches a bounded archive from GitHub and applies the same validation and secret scanning as uploaded ZIPs.</p></div>
                <button className="button button-primary" disabled={busy || !workspaceId || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(githubUrl.trim())}>{busy ? 'Fetching public archive…' : 'Import repository'}<Icon name="chevron" size={15}/></button>
              </form>}
            </div><aside className="setup-aside"><div className="surface-card aside-progress"><span className="section-kicker">WHAT HAPPENS NEXT</span><h3>From source to signal.</h3><div className="vertical-steps"><div className="vertical-step active"><span className="step-icon"><Icon name="upload" size={16}/></span><div><strong>Safe intake</strong><p>Validate paths, size, and content.</p></div></div><div className="step-line"/><div className="vertical-step"><span className="step-icon"><Icon name="search" size={16}/></span><div><strong>Evidence inventory</strong><p>Generate file digests and citations.</p></div></div><div className="step-line"/><div className="vertical-step"><span className="step-icon"><Icon name="shield" size={16}/></span><div><strong>Review & decide</strong><p>Review analysis is not connected in this release.</p></div></div></div></div><div className="aside-note"><Icon name="lock" size={15}/><p><strong>Your source stays yours.</strong> Evidence is scoped to the selected workspace.</p></div></aside></section>
          </>}

          {activePage === 'findings' && <>
            {activeReview ? <ReviewWorkflow review={activeReview} archive={archive} busy={busy} setBusy={setBusy} setError={setError} onAdd={addReviewFinding} onDecision={decideReviewFinding} onPublish={publishActiveReview} onOpenReport={() => setActivePage('reports')}/> : <>
            <div className="page-heading findings-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> EVIDENCE REVIEW</div><h1>Findings with receipts.</h1><p>Review each signal, inspect its citation, and record your decision.</p></div><span className="sample-tag"><Icon name="spark" size={14}/> EXAMPLE REVIEW</span></div>
            {archive && <div className="intake-banner"><span className="intake-check"><Icon name="check"/></span><div><strong>Evidence accepted</strong><span>{archive.digests.length} files inventoried · archive SHA-256 {archive.archiveSha256.slice(0, 12)}…{archive.sourceCommitSha ? ` · GitHub commit ${archive.sourceCommitSha}` : ''}</span></div><span className="status-pill status-accepted"><i/> Accepted</span></div>}
            <div className="findings-summary"><div><strong>{visibleFindings.length.toString().padStart(2, '0')}</strong><span>Findings</span></div><i/><div><strong>{findings.filter((item) => item.severity === 'High' && item.decision === 'Open').length.toString().padStart(2, '0')}</strong><span>High priority</span></div><i/><div><strong>{findings.filter((item) => item.decision !== 'Open').length.toString().padStart(2, '0')}</strong><span>Reviewed</span></div><button className="button button-secondary export-inline" onClick={() => setActivePage('reports')}><Icon name="file" size={16}/> Report preview</button></div>
            <div className="filter-row"><div className="filter-buttons" aria-label="Filter findings">{(['All', 'High', 'Medium', 'Low'] as const).map((item) => <button key={item} className={filter === item ? 'filter-active' : ''} onClick={() => setFilter(item)}>{item}{item === 'All' && <span>{findings.length}</span>}</button>)}</div><span className="sort-note"><Icon name="down" size={14}/> Priority</span></div>
            <div className="finding-list">{visibleFindings.map((finding) => <article className="finding-card surface-card" key={finding.id}><div className={`finding-rail rail-${finding.severity.toLowerCase()}`}/><div className="finding-card-main"><div className="finding-card-top"><div className="finding-id">{finding.id}<span>·</span><span className={`severity severity-${finding.severity.toLowerCase()}`}>{finding.severity.toUpperCase()}</span></div><span className="finding-confidence">{finding.confidence}% confidence <i/></span></div><h2>{finding.title}</h2><p className="finding-summary-text">{finding.summary}</p><div className="citation-row"><span className="kind-pill">{finding.kind}</span><span className="citation-divider"/><Icon name="file" size={14}/><code>{finding.path}{finding.line ? `:${finding.line}` : ''}</code><button className="citation-open" title="Citation preview" aria-label={`Open citation ${finding.path}`} onClick={() => setCitation(finding)}>↗</button></div><div className="finding-decision-row"><span className="decision-label">YOUR DECISION</span><div className="decision-actions"><button className={finding.decision === 'Accepted' ? 'decision-selected' : ''} onClick={() => decide(finding.id, finding.decision === 'Accepted' ? 'Open' : 'Accepted')}><Icon name="check" size={14}/> Accept</button><button className={finding.decision === 'Dismissed' ? 'decision-selected muted-selected' : ''} onClick={() => decide(finding.id, finding.decision === 'Dismissed' ? 'Open' : 'Dismissed')}>Dismiss</button><span className={`decision-status ${finding.decision !== 'Open' ? 'decided' : ''}`}>{finding.decision === 'Open' ? 'Awaiting review' : `Marked ${finding.decision.toLowerCase()}`}</span></div></div></div></article>)}</div>
            <p className="preview-disclaimer"><Icon name="spark" size={14}/> Example findings are illustrative and do not describe your uploaded archive.</p>
            </>}
          </>}

          {activePage === 'reports' && <>
            <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> REPORTS</div><h1>A report you can stand behind.</h1><p>Preview the decisions and evidence trail before sharing.</p></div></div>
            {activeReview ? <LiveReport review={activeReview} onExport={exportActiveReview}/> : <div className="report-layout"><aside className="surface-card report-controls"><span className="section-kicker">EXPORT OPTIONS</span><h2>Example review</h2><p className="report-muted">This preview uses sample findings and decisions.</p><button className="button button-primary full-button" onClick={() => exportReport('md')}><Icon name="download" size={16}/> ADR-ready Markdown</button><button className="button button-secondary full-button" onClick={() => exportReport('html')}><Icon name="download" size={16}/> Export HTML</button><button className="button button-secondary full-button" onClick={() => exportReport('json')}><Icon name="download" size={16}/> Export JSON</button><button className="button button-secondary full-button" onClick={() => window.print()}><Icon name="file" size={16}/> Print / save as PDF</button><div className="report-controls-note"><Icon name="lock" size={14}/> The exported example is generated in this browser.</div></aside><article className="report-paper"><div className="report-paper-head"><Brand compact/><span className="report-label">ARCHITECTURE REVIEW · PREVIEW</span></div><div className="report-paper-title"><span className="eyebrow">REVIEW SUMMARY · {new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' }).toUpperCase()}</span><h2>Example architecture<br/>review</h2><p>Evidence-led assessment with cited findings and reviewer decisions.</p></div><div className="report-kpis"><div><strong>{findings.length.toString().padStart(2, '0')}</strong><span>Findings</span></div><div><strong>{findings.filter((item) => item.severity === 'High').length.toString().padStart(2, '0')}</strong><span>High priority</span></div><div><strong>{findings.filter((item) => item.decision !== 'Open').length.toString().padStart(2, '0')}</strong><span>Decisions made</span></div></div><div className="report-section-title"><span>01</span><strong>Executive summary</strong></div><p className="report-body">This is an illustrative report preview. A review service is not connected yet, so the findings below are examples and are not conclusions about your system.</p><div className="report-section-title"><span>02</span><strong>Key findings</strong></div>{findings.slice(0, 3).map((finding) => <div className="report-finding" key={finding.id}><div><span className={`severity severity-${finding.severity.toLowerCase()}`}>{finding.severity.toUpperCase()}</span><span className="report-finding-id">{finding.id}</span></div><strong>{finding.title}</strong><p>{finding.summary}</p><code>{finding.path}{finding.line ? `:${finding.line}` : ''}</code><span className="report-decision">Decision: {finding.decision}</span></div>)}<div className="report-paper-foot"><span>ARCHGAUGE · EVIDENCE BEFORE OPINION</span><span>PREVIEW — NOT AN ASSESSMENT</span></div></article></div>}
          </>}
        </div>
        <footer className="app-footer"><span>ARCHGAUGE <i/> EVIDENCE BEFORE OPINION</span><span>ALL EVIDENCE IS DIGEST-PINNED <Icon name="shield" size={13}/></span></footer>
      </section>

      {creatingWorkspace && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) {setCreatingWorkspace(false);} }}><section ref={workspaceModalRef} className="modal-card" role="dialog" aria-modal="true" aria-labelledby="workspace-modal-title"><button className="modal-close icon-button" onClick={() => setCreatingWorkspace(false)} aria-label="Close">×</button><span className="modal-icon"><Icon name="grid" size={20}/></span><div className="eyebrow"><span className="eyebrow-dot"/> NEW WORKSPACE</div><h2 id="workspace-modal-title">Give your team a home.</h2><p>Workspaces keep evidence and review access scoped to your team.</p><form onSubmit={createWorkspace}><label htmlFor="workspace-name" className="field-label">Workspace name</label><input id="workspace-name" className="text-input" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} maxLength={120} autoFocus placeholder="e.g. Platform engineering" required/>{error && <p className="error-banner" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setCreatingWorkspace(false)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Creating…' : 'Create workspace'}<Icon name="chevron" size={15}/></button></div></form></section></div>}
      {citation && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) {setCitation(undefined);} }}><section className="modal-card citation-dialog" role="dialog" aria-modal="true" aria-labelledby="citation-title"><button className="modal-close icon-button" onClick={() => setCitation(undefined)} aria-label="Close citation">×</button><span className="section-kicker">SAMPLE CITATION · {citation.line ? `LINE ${citation.line}` : 'NO LINE REFERENCE'}</span><h2 id="citation-title">{citation.path}</h2><p>{citation.summary}</p><div className="citation-excerpt"><code>{citation.line ? `${citation.line}  ` : ''}{citation.title}</code><span>Illustrative citation preview. Source file content is not connected.</span></div><button className="button button-secondary" onClick={() => setCitation(undefined)}>Close</button></section></div>}
    </main>
  );
}

function LiveReport({ review, onExport }: { review: ReviewerReview; onExport: (format: 'json' | 'html' | 'markdown') => Promise<void> }) {
  const approved = review.findings.filter((finding) => finding.status === 'approved' || finding.status === 'published');
  const rejected = review.findings.filter((finding) => finding.status === 'rejected');
  const resolved = approved.length + rejected.length;
  return <div className="report-layout"><aside className="surface-card report-controls"><span className="section-kicker">REVIEW REPORT</span><h2>{review.status === 'published' ? 'Published review' : 'Draft review'}</h2><p className="report-muted">{review.status === 'published' ? 'This report contains reviewer-approved findings and cited evidence.' : 'Publish the review after resolving every proposal and approving at least one.'}</p>{review.status === 'published' ? <><button className="button button-primary full-button" onClick={() => void onExport('markdown')}><Icon name="download" size={16}/> ADR-ready Markdown</button><button className="button button-secondary full-button" onClick={() => void onExport('html')}><Icon name="download" size={16}/> Export HTML</button><button className="button button-secondary full-button" onClick={() => void onExport('json')}><Icon name="download" size={16}/> Export JSON</button><button className="button button-secondary full-button" onClick={() => window.print()}><Icon name="file" size={16}/> Print / save as PDF</button></> : <button className="button button-secondary full-button" onClick={() => window.print()}><Icon name="file" size={16}/> Print draft preview</button>}<div className="report-controls-note"><Icon name="lock" size={14}/> Exports are available after publication.</div></aside><article className="report-paper"><div className="report-paper-head"><Brand compact/><span className="report-label">ARCHITECTURE REVIEW · {review.status.toUpperCase()}</span></div><div className="report-paper-title"><span className="eyebrow">REVIEW SUMMARY · {new Date(review.createdAt).toLocaleDateString()}</span><h2>Architecture<br/>review</h2><p>Evidence-led assessment with cited findings and reviewer decisions.</p></div><div className="report-kpis"><div><strong>{review.findings.length.toString().padStart(2, '0')}</strong><span>Proposals</span></div><div><strong>{approved.length.toString().padStart(2, '0')}</strong><span>Approved</span></div><div><strong>{resolved.toString().padStart(2, '0')}</strong><span>Resolved</span></div></div><div className="report-section-title"><span>01</span><strong>Review status</strong></div><p className="report-body">{review.status === 'published' ? `Published ${review.publishedAt ? new Date(review.publishedAt).toLocaleString() : ''}.` : `${review.findings.length - resolved} proposals are awaiting a decision.`} Evidence intake {review.evidenceIntakeId}.{review.sourceCommitSha ? ` GitHub source commit ${review.sourceCommitSha}.` : ''}</p><div className="report-section-title"><span>02</span><strong>Findings and citations</strong></div>{review.findings.map((finding) => <div className="report-finding" key={finding.id}><div><span className="severity severity-medium">{finding.classification.replaceAll('_', ' ').toUpperCase()}</span><span className="report-finding-id">{finding.status.toUpperCase()}</span></div><strong>{finding.title}</strong><p>{finding.description}</p>{finding.citations.map((citation) => <code key={`${citation.path}:${citation.startLine}:${citation.sha256}`}>{citation.path}:{citation.startLine}-{citation.endLine} · SHA-256 {citation.sha256}</code>)}</div>)}<div className="report-paper-foot"><span>ARCHGAUGE · EVIDENCE BEFORE OPINION</span><span>{review.status.toUpperCase()} · VERSION {review.version}</span></div></article></div>;
}

function ReviewWorkflow(props: {
  review: ReviewerReview;
  archive?: AcceptedArchive;
  busy: boolean;
  setBusy: (value: boolean) => void;
  setError: (value: string) => void;
  onAdd: (input: { classification: ReviewFinding['classification']; title: string; description: string; citations: ReviewCitation[] }) => Promise<void>;
  onDecision: (findingId: string, decision: 'approve' | 'reject') => Promise<void>;
  onPublish: () => Promise<void>;
  onOpenReport: () => void;
}) {
  const [classification, setClassification] = useState<ReviewFinding['classification']>('fact');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [path, setPath] = useState(props.archive?.digests[0]?.path ?? '');
  const [startLine, setStartLine] = useState('1');
  const [endLine, setEndLine] = useState('1');
  const pending = props.review.findings.filter((finding) => finding.status === 'proposed').length;
  const approved = props.review.findings.filter((finding) => finding.status === 'approved' || finding.status === 'published').length;
  const allResolved = props.review.findings.length > 0 && pending === 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    props.setError('');
    const digest = props.archive?.digests.find((item) => item.path === path);
    if (classification !== 'insufficient_evidence' && !digest) {
      props.setError('Choose a file citation from this evidence archive.');
      return;
    }
    const citations = digest ? [{ path: digest.path, startLine: Number(startLine), endLine: Number(endLine), sha256: digest.hexDigest }] : [];
    props.setBusy(true);
    try {
      await props.onAdd({ classification, title: title.trim(), description: description.trim(), citations });
      setTitle(''); setDescription('');
    } catch (exception) {
      props.setError(exception instanceof Error ? exception.message : 'The finding could not be saved.');
    } finally {
      props.setBusy(false);
    }
  }

  async function runDecision(findingId: string, decision: 'approve' | 'reject') {
    props.setBusy(true); props.setError('');
    try { await props.onDecision(findingId, decision); }
    catch (exception) {props.setError(exception instanceof Error ? exception.message : 'The decision could not be saved.');}
    finally {props.setBusy(false);}
  }

  async function publish() {
    props.setBusy(true); props.setError('');
    try { await props.onPublish(); }
    catch (exception) {props.setError(exception instanceof Error ? exception.message : 'The review could not be published.');}
    finally {props.setBusy(false);}
  }

  return <>
    <div className="page-heading findings-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> HUMAN REVIEW</div><h1>Review findings and evidence.</h1><p>Add a cited proposal, record a decision, then publish the resolved review.</p></div><span className={`sample-tag ${props.review.status === 'published' ? 'published-tag' : ''}`}>{props.review.status === 'published' ? 'PUBLISHED' : 'DRAFT REVIEW'}</span></div>
    <div className="intake-banner"><span className="intake-check"><Icon name="check"/></span><div><strong>Accepted evidence</strong><span>{props.archive?.digests.length ?? 0} files · archive SHA-256 {props.archive?.archiveSha256.slice(0, 12) ?? '—'}…{props.review.sourceCommitSha ? ` · GitHub commit ${props.review.sourceCommitSha}` : ''}</span></div><span className="status-pill status-accepted"><i/> {props.review.status === 'published' ? 'Published' : 'Draft'}</span></div>
    <div className="findings-summary"><div><strong>{props.review.findings.length.toString().padStart(2, '0')}</strong><span>Proposals</span></div><i/><div><strong>{pending.toString().padStart(2, '0')}</strong><span>Awaiting decision</span></div><i/><div><strong>{approved.toString().padStart(2, '0')}</strong><span>Approved</span></div><button className="button button-secondary export-inline" onClick={props.onOpenReport}><Icon name="file" size={16}/> Report</button></div>
    {props.review.findings.length === 0 ? <div className="review-empty-note"><Icon name="spark" size={15}/> No automated findings are generated. Add a human-authored proposal and cite an inventoried file.</div> : <div className="finding-list review-finding-list">{props.review.findings.map((finding) => <article className="finding-card surface-card" key={finding.id}><div className={`finding-rail rail-${finding.status === 'proposed' ? 'medium' : finding.status === 'rejected' ? 'low' : 'high'}`}/><div className="finding-card-main"><div className="finding-card-top"><div className="finding-id">{finding.id}<span>·</span><span className="kind-pill">{finding.classification.replaceAll('_', ' ')}</span></div><span className={`decision-status ${finding.status !== 'proposed' ? 'decided' : ''}`}>{finding.status === 'proposed' ? 'Awaiting review' : `Marked ${finding.status}`}</span></div><h2>{finding.title}</h2><p className="finding-summary-text">{finding.description}</p>{finding.citations.length > 0 && <div className="review-citations">{finding.citations.map((citation) => <div className="citation-row" key={`${finding.id}:${citation.path}:${citation.startLine}`}><Icon name="file" size={14}/><code>{citation.path}:{citation.startLine}–{citation.endLine}</code><span className="citation-hash">SHA-256 {citation.sha256.slice(0, 12)}…</span></div>)}</div>}<div className="finding-decision-row"><span className="decision-label">HUMAN DECISION</span>{finding.status === 'proposed' && props.review.status === 'draft' ? <div className="decision-actions"><button disabled={props.busy} onClick={() => void runDecision(finding.id, 'approve')}><Icon name="check" size={14}/> Approve</button><button disabled={props.busy} onClick={() => void runDecision(finding.id, 'reject')}>Reject</button></div> : <span className={`decision-status ${finding.status !== 'proposed' ? 'decided' : ''}`}>{finding.status === 'published' ? 'Published after approval' : finding.status === 'rejected' ? 'Rejected' : 'Approved'}</span>}</div></div></article>)}</div>}
    {props.review.status === 'draft' && <form className="surface-card add-finding-form" onSubmit={submit}><div><span className="section-kicker">ADD A FINDING</span><h2>Capture a review proposal</h2><p>Claims need a file citation and digest. Evidence gaps may omit a citation.</p></div><label className="field-label">Evidence classification<select className="text-input" value={classification} onChange={(event) => setClassification(event.target.value as ReviewFinding['classification'])}><option value="fact">Fact</option><option value="inference">Inference</option><option value="assumption">Assumption</option><option value="insufficient_evidence">Insufficient evidence</option></select></label><label className="field-label">Title<input className="text-input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={180} required/></label><label className="field-label">Description<textarea className="text-input review-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} required/></label>{classification !== 'insufficient_evidence' && <div className="citation-fields"><label className="field-label">Evidence file<select className="text-input" value={path} onChange={(event) => setPath(event.target.value)} required><option value="">Choose an inventoried file</option>{props.archive?.digests.map((digest) => <option key={digest.path} value={digest.path}>{digest.path}</option>)}</select></label><label className="field-label">Start line<input className="text-input" type="number" min="1" step="1" value={startLine} onChange={(event) => setStartLine(event.target.value)} required/></label><label className="field-label">End line<input className="text-input" type="number" min={startLine || '1'} step="1" value={endLine} onChange={(event) => setEndLine(event.target.value)} required/></label></div>}<div className="form-actions"><button className="button button-primary" disabled={props.busy || props.review.status !== 'draft'}>Save cited proposal <Icon name="chevron" size={15}/></button></div></form>}
    {props.review.status === 'draft' && <div className="publish-review-row"><span>{pending ? `${pending} proposal${pending === 1 ? '' : 's'} need a decision.` : allResolved && approved ? 'All proposals are resolved and at least one is approved.' : 'Approve at least one proposal to publish this review.'}</span><button className="button button-primary" disabled={props.busy || !allResolved || approved === 0} onClick={() => void publish()}>Publish review <Icon name="chevron" size={15}/></button></div>}
  </>;
}
