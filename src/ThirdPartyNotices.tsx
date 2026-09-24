import { useState } from 'react';

export default function ThirdPartyNotices() {
  const [notices, setNotices] = useState('');
  const [error, setError] = useState('');
  return <details className="third-party-notices" onToggle={event => {
    if (event.currentTarget.open && !notices) void import('../THIRD_PARTY_NOTICES.txt?raw').then(module => setNotices(module.default)).catch(() => setError('Could not load acknowledgements. See THIRD_PARTY_NOTICES.txt in the app resources.'));
  }}><summary>Third-party acknowledgements</summary><pre tabIndex={0}>{error || notices || 'Loading acknowledgements…'}</pre></details>;
}
