import { useRef, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import type { Components } from 'react-markdown';
import { languageFor, tokenize } from './highlight';
import { errorText } from './format';

function CodeBlock({ children }: { children?: ReactNode }) {
  const pre = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  // Copy the rendered text so it matches exactly what is displayed, without Markdown fences.
  const copy = () => { setCopyError(''); void window.prime.copyText((pre.current?.textContent ?? '').replace(/\n$/, '')).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }).catch(error => setCopyError(`Copy failed: ${errorText(error)}`)); };
  return <div className="code-block"><pre ref={pre}>{children}</pre><button type="button" className="copy-code icon-button" aria-label={copied ? 'Code copied' : 'Copy code'} title="Copy code" onClick={copy}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>{copyError && <p role="alert">{copyError}</p>}</div>;
}
// Untrusted Markdown: links open externally and images are never loaded inline.
export const markdownComponents: Components = {
  a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
  img: ({ alt, src }) => <a href={src} target="_blank" rel="noreferrer">[Image: {alt || 'View image'}]</a>,
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ className, children }) => {
    const language = languageFor(className);
    if (!language || typeof children !== 'string') return <code className={className}>{children}</code>;
    return <code className={className}>{tokenize(children, language).map((token, index) => token.kind === 'plain' ? token.text : <span key={index} className={`tok-${token.kind}`}>{token.text}</span>)}</code>;
  },
};
