import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { V5Player, type V5Language } from './v5';

/**
 * Portal wrapper that lets the V5 player be opened from the lecture list the
 * same way V4PlayerDialog opens V4.
 *
 * V5 renders its own full-viewport chrome (`.v5-player` is 100vw/100dvh), so
 * like V4 it is portalled straight to document.body rather than nested in a
 * Dialog — a Dialog would clip it and double up the backdrop.
 *
 * Unlike V4PlayerDialog there is no job-ID entry form: that exists for the
 * standalone /v5-player lab page, and a learner opening a lecture always
 * arrives with a job id already resolved.
 */

interface V5PlayerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialJobId?: string;
  /** Free-form language string from the lecture list, normalised below. */
  initialLanguage?: string | null;
}

const toV5Language = (value?: string | null): V5Language =>
  value?.toLowerCase() === 'kannada' ? 'kannada' : 'english';

export const V5PlayerDialog = ({
  open,
  onOpenChange,
  initialJobId,
  initialLanguage,
}: V5PlayerDialogProps) => {
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  useEffect(() => {
    if (open && initialJobId && !activeJobId) {
      setActiveJobId(initialJobId);
    }
  }, [open, initialJobId, activeJobId]);

  // Reset on close so reopening a different lecture doesn't replay the old job.
  useEffect(() => {
    if (!open) setActiveJobId(null);
  }, [open]);

  if (!open || !activeJobId) return null;

  return createPortal(
    <V5Player
      jobId={activeJobId}
      initialLanguage={toV5Language(initialLanguage)}
      onExit={() => onOpenChange(false)}
    />,
    document.body,
  );
};
