import { ArrowDown, ArrowRight, Code2, FolderOpen, GitBranch, Search, Sparkles } from 'lucide-react';
import DockMark from './DockMark';

const starters = [
  { icon: Code2, title: 'Build something new', description: 'Turn an idea into working code', prompt: 'Help me build a new project. First, ask me about what I want to create.' },
  { icon: Search, title: 'Explore a codebase', description: 'Find your way around a project', prompt: 'Explore this codebase and explain its structure, key components, and how to get started.' },
  { icon: GitBranch, title: 'Make it better', description: 'Find bugs and thoughtful improvements', prompt: 'Review this project for bugs and opportunities to improve it. Explain your findings before making changes.' },
];

export default function Welcome({ onStarter }: { onStarter: (prompt: string) => void }) {
  return <div className="welcome"><div className="welcome-eyebrow"><span className="eyebrow-line" /> A LITTLE DIRECTION. ENDLESS POSSIBILITY.</div><div className="hero-mark"><DockMark /><span className="hero-spark"><Sparkles size={15} /></span></div><h1>Good ideas deserve<br />a <span>head start.</span></h1><p className="welcome-description">Meet your coding partner. Build, explore, and solve<br className="desktop-break" /> together, right from your workspace.</p><div className="starter-heading"><span>WHERE SHOULD WE START?</span><span>Pick a direction, or make your own<ArrowDown size={12} /></span></div><div className="starter-grid">{starters.map(({ icon: Icon, title, description, prompt }) => <button key={title} className="starter-card" onClick={() => onStarter(prompt)}><div className="starter-icon"><Icon size={20} /><ArrowRight size={15} /></div><strong>{title}</strong><span>{description}</span></button>)}</div><div className="welcome-note"><FolderOpen size={14} /><span>Start in a project folder. Prime takes it from there.</span></div><p className="safety-note">Agents run with your user permissions. No sandbox.</p></div>;
}
