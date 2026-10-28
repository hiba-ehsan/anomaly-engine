'use client';

import { createChart, ColorType, IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import { pricesToCandlesticks, anomaliesToMarkers } from '@/lib/hooks';
import { useEffect, useRef, useState } from 'react';

interface PriceChartProps {
  prices: any[];
  anomalies?: any[];
  height?: number;
  width?: number;
}

export function PriceChart({ prices, anomalies = [], height = 400, width }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const [chartSize, setChartSize] = useState({ width: 0, height });

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: width || containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#030712' },
        textColor: '#d1d4dc',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1f2937' },
        horzLines: { color: '#1f2937' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: '#1f2937',
        borderVisible: false,
      },
      timeScale: {
        borderColor: '#1f2937',
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      handleScale: {
        axisPressedMouseMove: {
          time: true,
          price: true,
        },
        axisDoubleClickReset: {
          time: true,
          price: true,
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });

    chartRef.current = chart;
    seriesRef.current = candleSeries;
    setChartSize({ width: width || containerRef.current.clientWidth, height });

    // Set data
    const candlesticks = pricesToCandlesticks(prices);
    candleSeries.setData(candlesticks as any);

    // Add anomaly markers
    if (anomalies.length > 0) {
      const markers = anomaliesToMarkers(anomalies);
      candleSeries.setMarkers(markers as any);
    }

    // Handle resize
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        chart.applyOptions({ width, height });
        setChartSize({ width, height });
      }
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [prices, anomalies, height, width]);

  return (
    <div
      ref={containerRef}
      style={{ width: width || '100%', height }}
      className="rounded-lg border border-gray-800 bg-gray-950"
    />
  );
}