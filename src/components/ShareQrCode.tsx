import { createMemo } from 'solid-js';
import { encode } from 'uqr';

export interface ShareQrCodeProps {
  link: string;
  label: string;
  description: string;
  heading?: string;
  size?: 'sm' | 'md';
}

export default function ShareQrCode(props: ShareQrCodeProps) {
  const qr = createMemo(() => {
    const { data, size } = encode(props.link, { border: 4, ecc: 'M' });
    const modules: string[] = [];
    for (const [y, row] of data.entries()) {
      for (const [x, dark] of row.entries()) {
        if (dark) modules.push(`M${x} ${y}h1v1h-1z`);
      }
    }
    return { size, path: modules.join('') };
  });

  const isCompact = () => props.size === 'sm';

  return (
    <figure
      class={[
        'flex items-center gap-3 rounded-md p-2.5 sm:gap-4',
        isCompact() ? 'bg-surface-subtle/75' : 'bg-surface-subtle',
      ]}
    >
      <svg
        role="img"
        aria-label={props.label}
        class={[
          'aspect-square shrink-0 rounded-sm bg-white',
          isCompact() ? 'w-24 max-w-[40%] sm:w-28' : 'w-28 max-w-[45%] sm:w-32',
        ]}
        viewBox={`0 0 ${qr().size} ${qr().size}`}
        shape-rendering="crispEdges"
      >
        <rect width="100%" height="100%" fill="white" />
        <path d={qr().path} fill="black" />
      </svg>
      <figcaption
        class={[
          'min-w-0 text-text-muted',
          isCompact() ? 'text-xs leading-relaxed' : 'text-sm',
        ]}
      >
        <strong
          class={[
            'block font-semibold text-text',
            isCompact() ? 'text-sm' : 'text-base',
          ]}
        >
          {props.heading ?? 'Scan to join'}
        </strong>
        {props.description}
      </figcaption>
    </figure>
  );
}
