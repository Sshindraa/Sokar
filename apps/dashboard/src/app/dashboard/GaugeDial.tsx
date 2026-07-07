'use client';

// Jauge circulaire façon cockpit (inspirée des dashboards industriels type
// éolienne/production) : arc de 270° avec la valeur en héros au centre.
// Rendu en SVG pur pour rester léger (pas de lib de charting pour un simple indicateur).

const START_ANGLE = 135;
const SWEEP = 270;

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

export default function GaugeDial({
  value,
  label,
  sublabel,
  suffix = '%',
  size = 168,
  accentClassName = 'text-cyan-600 dark:text-cyan-400',
}: {
  value: number;
  label: string;
  sublabel?: string;
  suffix?: string;
  size?: number;
  accentClassName?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const cx = 100;
  const cy = 100;
  const r = 82;
  const trackPath = describeArc(cx, cy, r, START_ANGLE, START_ANGLE + SWEEP);
  const valuePath = describeArc(cx, cy, r, START_ANGLE, START_ANGLE + (clamped / 100) * SWEEP);

  return (
    <div
      className="relative mx-auto flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 200 200" width={size} height={size} className="-rotate-0">
        <path
          d={trackPath}
          fill="none"
          className="stroke-border"
          strokeWidth={14}
          strokeLinecap="round"
        />
        <path
          d={valuePath}
          fill="none"
          className={accentClassName}
          stroke="currentColor"
          strokeWidth={14}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-3xl font-black tracking-tight text-foreground md:text-4xl">
          {clamped}
          <span className="text-lg font-bold text-muted-foreground">{suffix}</span>
        </span>
        <span className="mt-1 max-w-[9rem] text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {sublabel && (
          <span className="mt-0.5 text-[10px] text-muted-foreground/70">{sublabel}</span>
        )}
      </div>
    </div>
  );
}
