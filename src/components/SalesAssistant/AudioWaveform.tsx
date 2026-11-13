interface AudioWaveformProps {
  isActive: boolean;
  color?: string;
}

export const AudioWaveform = ({ isActive, color = "bg-primary" }: AudioWaveformProps) => {
  const bars = [
    "![animation-delay:0s] ![animation-duration:0.4s]",
    "![animation-delay:0.1s] ![animation-duration:0.5s]",
    "![animation-delay:0.2s] ![animation-duration:0.3s]",
    "![animation-delay:0.15s] ![animation-duration:0.6s]",
    "![animation-delay:0.05s] ![animation-duration:0.4s]",
    "![animation-delay:0.25s] ![animation-duration:0.5s]",
    "![animation-delay:0.1s] ![animation-duration:0.35s]",
  ];

  return (
    <div className="flex items-end justify-center gap-1 h-12">
      {bars.map((barClass, index) => (
        <div
          key={index}
          className={`w-1 rounded-full transition-all ${color} ${
            isActive ? `waveform-bar ${barClass}` : "h-2"
          }`}
        />
      ))}
    </div>
  );
};
