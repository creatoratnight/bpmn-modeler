import { useEffect, useState } from 'react';
import { CollaborationSession } from './CollaborationSession';
import { toPeerIdentity, type UserLike } from './identity';
import type { Peer } from './types';

interface UseCollaborationArgs {
    /** The model being edited, or null/undefined when no model is open. */
    modelId: string | null | undefined;
    /** The signed-in user, or null when signed out. */
    user: UserLike | null | undefined;
    /** Master switch — collaboration only runs when this is true. */
    enabled: boolean;
}

interface UseCollaborationResult {
    /** The live session, or null when collaboration is inactive. Passed to the modeler. */
    session: CollaborationSession | null;
    /** Everyone currently editing this model except the local user. */
    peers: Peer[];
}

/**
 * Owns the collaboration session lifecycle for the currently open model. It
 * joins on mount, leaves on unmount, and re-creates the session whenever the
 * model or user changes. The returned `session` is handed to the modeler (which
 * attaches the cursor/selection binding); `peers` drives the presence bar.
 */
export function useCollaboration({ modelId, user, enabled }: UseCollaborationArgs): UseCollaborationResult {
    const [session, setSession] = useState<CollaborationSession | null>(null);
    const [peers, setPeers] = useState<Peer[]>([]);

    useEffect(() => {
        if (!enabled || !modelId || !user?.uid) {
            setSession(null);
            setPeers([]);
            return;
        }

        const s = new CollaborationSession(modelId, toPeerIdentity(user));
        s.join().catch((err) => console.error('Failed to join collaboration session', err));
        const unsubPeers = s.onPeers(setPeers);
        setSession(s);

        return () => {
            unsubPeers();
            s.leave().catch(() => {});
            setSession(null);
            setPeers([]);
        };
        // user identity is keyed by uid; other fields (name/avatar) rarely change
        // mid-session and are not worth tearing the session down for.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, modelId, user?.uid]);

    return { session, peers };
}
