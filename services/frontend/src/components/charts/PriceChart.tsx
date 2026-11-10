'use client';

import { createChart, ColorType, IChartApi, ISeriesApi } from 'lightweight-charts';
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
  const [, setChartSize] = useState({ width: 0, height });

  useEffect(() => {
    if (!containerRef.current) return;

    // Financial + Kinetic Palette
    const chart = createChart(containerRef.current, {
      width: width || containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#07090e' },
        textColor: '#c9ced8',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1a1f2c' },
        horzLines: { color: '#1a1f2c' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: '#303139',
        borderVisible: true,
      },
      timeScale: {
        borderColor: '#303139',
        borderVisible: true,
        timeVisible: true,
        secondsVisible: false,
      },
      handleScale: {
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#4ade80',
      downColor: '#f87171',
      borderUpColor: '#4ade80',
      borderDownColor: '#f87171',
      wickUpColor: '#4ade80',
      wickDownColor: '#f87171',
    });

    chartRef.current = chart;
    seriesRef.current = candleSeries;
    setChartSize({ width: width || containerRef.current.clientWidth, height });

    try {
      // 1. Process candlesticks: ensure strict ascending time and no duplicates
      const candlesticks = pricesToCandlesticks(prices);
      if (candlesticks.length > 0) {
        candleSeries.setData(candlesticks as any);
      }

      // 2. Process markers: strictly ascending time order (required by Lightweight Charts)
      if (anomalies && anomalies.length > 0) {
        const markers = anomaliesToMarkers(anomalies);
        if (markers.length > 0) {
          candleSeries.setMarkers(markers as any);
        }
      }
    } catch (chartErr) {
      console.warn('Lightweight charts data binding error safely handled:', chartErr);
    }

    // Handle resize
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: currentWidth, height: currentHeight } = entry.contentRect;
        chart.applyOptions({ width: currentWidth, height: currentHeight });
        setChartSize({ width: currentWidth, height: currentHeight });
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
      className="border border-line bg-ground"
    />
  );
}
