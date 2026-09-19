// Shown when a lecture video ends: lets the student type or speak a
// question, sends it to Athena, then hands off to HyperframeAnswerPlayer.
// Entirely separate from V5Player/V5PlayerDialog — this only reacts to a
// video-ended signal passed in as a prop, it doesn't reach into the player.
import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send, Sparkles, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { voiceLock } from "@/lib/voiceLock";
import { usePostLectureAthenaAnswer } from "@/hooks/usePostLectureAthenaAnswer";
import { HyperframeAnswerPlayer } from "./HyperframeAnswerPlayer";

interface PostLectureDoubtDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjectName?: string;
  athenaSubjectId: string;
  athenaChapterId?: string;
  athenaTopicId?: string;
}

const SpeechRecognitionAPI =
  typeof window !== "undefined"
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

export function PostLectureDoubtDialog({
  open,
  onOpenChange,
  subjectName,
  athenaSubjectId,
  athenaChapterId,
  athenaTopicId,
}: PostLectureDoubtDialogProps) {
  const [questionText, setQuestionText] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [askedQuestion, setAskedQuestion] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const { state, ask, reset } = usePostLectureAthenaAnswer();

  useEffect(() => {
    if (!open) {
      setQuestionText("");
      setAskedQuestion(null);
      reset();
      try {
        recognitionRef.current?.abort();
      } catch {
        /* noop */
      }
      voiceLock.release("postLecture");
    }
  }, [open, reset]);

  const stopListening = () => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* noop */
    }
    recognitionRef.current = null;
    setIsListening(false);
    voiceLock.release("postLecture");
  };

  const startListening = async () => {
    if (!SpeechRecognitionAPI) return;
    voiceLock.acquire("postLecture");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      toast.error("Microphone permission denied");
      voiceLock.release("postLecture");
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = "en-IN";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event: any) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
      setQuestionText(text);
    };
    recognition.onerror = () => {
      setIsListening(false);
      recognitionRef.current = null;
      voiceLock.release("postLecture");
    };
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
      voiceLock.release("postLecture");
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsListening(true);
    } catch {
      voiceLock.release("postLecture");
    }
  };

  const toggleMic = () => (isListening ? stopListening() : startListening());

  const handleAsk = () => {
    const question = questionText.trim();
    if (!question) return;
    if (isListening) stopListening();
    setAskedQuestion(question);
    void ask({
      question,
      subjectId: athenaSubjectId,
      chapterId: athenaChapterId,
      topicId: athenaTopicId,
    });
  };

  const handleClosePlayer = () => {
    setAskedQuestion(null);
    reset();
    onOpenChange(false);
  };

  if (askedQuestion) {
    return (
      <HyperframeAnswerPlayer
        answerId={state.meta?.answer_id ?? null}
        phase={state.phase}
        segments={state.segments}
        video={state.video}
        errorMessage={state.errorMessage}
        questionText={askedQuestion}
        onClose={handleClosePlayer}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Have a question about this lecture?
          </DialogTitle>
          <DialogDescription>
            Ask anything about {subjectName ? `this ${subjectName} lecture` : "what you just watched"} — type
            it or use the mic.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            value={questionText}
            onChange={(e) => setQuestionText(e.target.value)}
            placeholder="Type your question…"
            rows={3}
            autoFocus
          />
          <div className="flex gap-2">
            {!!SpeechRecognitionAPI && (
              <Button
                type="button"
                variant={isListening ? "destructive" : "outline"}
                size="icon"
                onClick={toggleMic}
                className="shrink-0"
                aria-label={isListening ? "Stop listening" : "Ask by voice"}
              >
                {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
            )}
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="flex-1">
              <X className="mr-2 h-4 w-4" /> Skip
            </Button>
            <Button onClick={handleAsk} disabled={!questionText.trim()} className="flex-1">
              <Send className="mr-2 h-4 w-4" /> Ask
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
