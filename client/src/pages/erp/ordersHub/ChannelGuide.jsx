import { useState } from 'react';
import Card from '../../../components/Card';
import { theme, btnSecondary } from '../shared';
import { CHANNEL_GUIDES } from './guides';

/**
 * Collapsible per-channel guide for obtaining API credentials.
 * Collapsed by default so it does not dominate the credentials form.
 */
export function ChannelGuide({ channelId }) {
  const guide = CHANNEL_GUIDES[channelId];
  const [open, setOpen] = useState(false);

  if (!guide) return null;

  return (
    <Card title={guide.title} style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: open ? 12 : 0 }}>
        <button type="button" style={btnSecondary} onClick={() => setOpen(o => !o)}>
          {open ? 'Hide guide' : 'How to get your API keys'}
        </button>
        <a
          href={guide.officialUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 12, color: theme.teal, textDecoration: 'underline' }}
        >
          {guide.officialLabel}
        </a>
      </div>
      {open ? (
        <div>
          <ol style={{ margin: '0 0 12px', paddingLeft: 20, color: theme.textStrong, fontSize: 13, lineHeight: 1.5 }}>
            {guide.steps.map((step, i) => (
              <li key={i} style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 700, color: theme.textStrong }}>{step.title}</div>
                <div style={{ color: theme.textDim, marginTop: 2 }}>{step.body}</div>
              </li>
            ))}
          </ol>
          {guide.scopes?.length ? (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: theme.textFaint, textTransform: 'uppercase', marginBottom: 6 }}>
                Required scopes
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: theme.textDim, wordBreak: 'break-all' }}>
                {guide.scopes.map(s => (
                  <li key={s} style={{ marginBottom: 2 }}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <p style={{ fontSize: 12, color: theme.textDim, margin: '8px 0 0' }}>
          Step-by-step instructions to create credentials in the official portal, then paste them below.
        </p>
      )}
    </Card>
  );
}
