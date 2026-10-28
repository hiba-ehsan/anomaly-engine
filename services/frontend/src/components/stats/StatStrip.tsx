'use client';

import { useRef } from 'react';
import gsap from 'gsap';
import { CountUpStat } from '@/components/stats/CountUpStat';

export function StatStrip({
  items,
}: {
  items: Array<{ title: string; value: number; label?: string; accent?: 'yellow' | 'green' | 'red' }>;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const proxy = { offset: 0 };

  function onWheel(e: React.WheelEvent) {
    if (!stripRef.current) return;
    proxy.offset -= e.deltaY * 0.9;
    proxy.offset = Math.max(0, Math.min(proxy.offset, stripRef.current.scrollWidth - stripRef.current.clientWidth));
    gsap.to(stripRef.current, {
      scrollLeft: proxy.offset,
      duration: 0.7,
      ease: 'power2.out',
    });
  }

  return (
    <div
      ref={stripRef}
      onWheel={onWheel}
      className="overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex gap-4 min-w-max">
        {items.map((item) => (
          <CountUpStat
            key={item.title}
            title={item.title}
            value={item.value}
            label={item.label}
            accent={item.accent}
          />
        ))}
      </div>
    </div>
  );
}
