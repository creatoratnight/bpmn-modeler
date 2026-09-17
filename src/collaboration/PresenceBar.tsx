import React from 'react';
import type { Peer } from './types';

interface PresenceBarProps {
    peers: Peer[];
    /** Cap how many avatars render before collapsing into a "+N" chip. */
    max?: number;
}

function initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * A stacked row of avatars showing who else is editing the current model, each
 * ringed in that person's cursor color. Someone who has stepped away from their
 * window is dimmed, so the bar shows who is actually working rather than who
 * happens to have the model open. Renders nothing when you are alone.
 * Purely presentational — it is driven by the `peers` from `useCollaboration`.
 */
const PresenceBar: React.FC<PresenceBarProps> = ({ peers, max = 5 }) => {
    if (!peers.length) return null;

    const shown = peers.slice(0, max);
    const overflow = peers.length - shown.length;

    return (
        <div className="collab-presence-bar" style={{ display: 'flex', alignItems: 'center', paddingRight: '8px' }}>
            {shown.map((peer, i) => (
                <div
                    key={peer.uid}
                    title={peer.idle ? `${peer.name} (away)` : peer.name}
                    style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        marginLeft: i === 0 ? 0 : -8,
                        border: `2px solid ${peer.color}`,
                        boxShadow: '0 0 0 1px #fff',
                        background: peer.color,
                        opacity: peer.idle ? 0.4 : 1,
                        filter: peer.idle ? 'grayscale(1)' : undefined,
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        fontWeight: 600,
                        overflow: 'hidden',
                        boxSizing: 'border-box',
                        zIndex: shown.length - i,
                    }}
                >
                    {peer.avatarUrl
                        ? <img src={peer.avatarUrl} alt={peer.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : initials(peer.name)}
                </div>
            ))}
            {overflow > 0 && (
                <div
                    title={peers.slice(max).map((p) => p.name).join(', ')}
                    style={{
                        width: 28, height: 28, borderRadius: '50%', marginLeft: -8,
                        border: '2px solid #8d8d8d', boxShadow: '0 0 0 1px #fff', background: '#e0e0e0',
                        color: '#161616', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 600, boxSizing: 'border-box',
                    }}
                >
                    +{overflow}
                </div>
            )}
        </div>
    );
};

export default PresenceBar;
