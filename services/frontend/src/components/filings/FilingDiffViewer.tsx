'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface FilingDiffViewerProps {
  filingA: {
    id: string;
    filing_type: string;
    filing_date: string;
    sections: Record<string, string>;
  };
  filingB: {
    id: string;
    filing_type: string;
    filing_date: string;
    sections: Record<string, string>;
  };
  onClose: () => void;
}

export function FilingDiffViewer({ filingA, filingB, onClose }: FilingDiffViewerProps) {
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'side-by-side' | 'inline'>('side-by-side');

  const allSections = useMemo(() => {
    const keys = new Set([...Object.keys(filingA.sections), ...Object.keys(filingB.sections)]);
    return Array.from(keys).sort();
  }, [filingA.sections, filingB.sections]);

  const getSectionDiff = (sectionKey: string) => {
    const textA = filingA.sections[sectionKey] || '';
    const textB = filingB.sections[sectionKey] || '';
    
    if (!textA && !textB) return { type: 'empty' };
    if (!textA) return { type: 'added', content: textB };
    if (!textB) return { type: 'removed', content: textA };
    if (textA === textB) return { type: 'unchanged', content: textA };
    
    // Simple diff - split by sentences
    const sentencesA = textA.split(/(?<=[.!?])\s+/);
    const sentencesB = textB.split(/(?<=[.!?])\s+/);
    
    return { type: 'modified', contentA: sentencesA, contentB: sentencesB };
  };

  return (
    <div className="fixed inset-0 z-50 bg-navy-950/95 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-7xl max-h-[90vh] bg-navy-900 border border-navy-700 rounded-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-navy-700 bg-navy-900/50">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold text-white">Filing Comparison</h2>
            <div className="flex items-center gap-2">
              <Badge variant="info">{filingA.filing_type}</Badge>
              <Badge variant="info">{filingB.filing_type}</Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as 'side-by-side' | 'inline')}
              className="px-3 py-1 bg-navy-800 border border-navy-600 rounded-lg text-white text-sm"
            >
              <option value="side-by-side">Side by Side</option>
              <option value="inline">Inline Diff</option>
            </select>
            <button onClick={onClose} className="p-2 text-navy-400 hover:text-white hover:bg-navy-800 rounded-lg transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        {/* Section Navigator */}
        <div className="border-b border-navy-700 bg-navy-900/50 px-4 py-2 overflow-x-auto flex gap-2">
          {Object.keys(filingA.sections).map((sectionKey) => (
            <button
              key={sectionKey}
              onClick={() => setSelectedSection(sectionKey)}
              className={`whitespace-nowrap px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedSection === sectionKey
                  ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                  : 'text-navy-400 hover:text-white hover:bg-navy-800'
              }`}
            >
              {sectionKey.replace('_', ' ').toUpperCase()}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-auto p-6">
          {selectedSection ? (
            <SectionDiffViewer
              sectionKey={selectedSection}
              contentA={filingA.sections[selectedSection] || ''}
              contentB={filingB.sections[selectedSection] || ''}
              viewMode={viewMode}
              filingADate={filingA.filing_date}
              filingBDate={filingB.filing_date}
              filingAType={filingA.filing_type}
              filingBType={filingB.filing_type}
            />
          ) : (
            <div className="flex items-center justify-center h-64 text-navy-500">
              <p className="text-center">Select a section to view diff</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface SectionDiffViewerProps {
  sectionKey: string;
  contentA: string;
  contentB: string;
  viewMode: 'side-by-side' | 'inline';
  filingADate: string;
  filingBDate: string;
  filingAType: string;
  filingBType: string;
}

function SectionDiffViewer({ sectionKey, contentA, contentB, viewMode, filingADate, filingBDate, filingAType, filingBType }: SectionDiffViewerProps) {
  const diff = useMemo(() => computeDiff(contentA, contentB), [contentA, contentB]);

  if (viewMode === 'side-by-side') {
    return (
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-navy-900/50 border border-red-500/20 rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-white">{filingAType} - {new Date(filingADate).toLocaleDateString()}</h3>
            <span className="px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded">Original</span>
          </div>
          <div className="prose prose-invert max-w-none whitespace-pre-wrap text-gray-300 leading-relaxed border border-red-500/20 rounded-lg p-4 max-h-[60vh] overflow-y-auto">
            {diff.type === 'removed' || diff.type === 'modified' ? (
              <DiffText content={diff.type === 'removed' ? contentA : diff.contentA} type="removed" />
            ) : (
              <span className="text-green-400">{contentA}</span>
            )}
          </div>
        </div>
        <div className="bg-navy-900/50 border border-green-500/20 rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-white">{filingBType} - {new Date(filingBDate).toLocaleDateString()}</h3>
            <span className="px-2 py-1 text-xs bg-green-500/20 text-green-400 rounded">Current</span>
          </div>
          <div className="prose prose-invert max-w-none whitespace-pre-wrap text-gray-300 leading-relaxed border border-green-500/20 rounded-lg p-4 max-h-[60vh] overflow-y-auto">
            {diff.type === 'added' || diff.type === 'modified' ? (
              <DiffText content={diff.type === 'added' ? contentB : diff.contentB} type="added" />
            ) : (
              <span className="text-green-400">{contentB}</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {diff.type === 'unchanged' ? (
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-6">
          <p className="text-green-400 font-medium">No changes detected in this section</p>
          <div className="prose prose-invert max-w-none whitespace-pre-wrap text-gray-300 leading-relaxed mt-4">
            {contentA}
          </div>
        </div>
      ) : diff.type === 'added' ? (
        <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="px-2 py-1 text-xs bg-green-500/20 text-green-400 rounded">ADDED</span>
            <span className="text-green-400 font-medium">New content in current filing</span>
          </div>
          <div className="prose prose-invert max-w-none whitespace-pre-wrap text-green-300 leading-relaxed border-l-4 border-green-500 pl-4">
            {contentB}
          </div>
        </div>
      ) : diff.type === 'removed' ? (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded">REMOVED</span>
            <span className="text-red-400 font-medium">Content removed from previous filing</span>
          </div>
          <div className="prose prose-invert max-w-none whitespace-pre-wrap text-red-300 leading-relaxed border-l-4 border-red-500 pl-4 line-through">
            {contentA}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="px-2 py-1 text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded">MODIFIED</span>
            <span className="text-yellow-400 font-medium">Content modified between filings</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
              <h4 className="font-bold text-red-400 mb-2">Removed / Changed</h4>
              <div className="prose prose-invert max-w-none whitespace-pre-wrap text-red-300 leading-relaxed border border-red-500/20 rounded-lg p-4 max-h-[60vh] overflow-y-auto">
                <DiffText content={contentA} type="removed" />
              </div>
            </div>
            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4">
              <h4 className="font-bold text-green-400 mb-2">Added / Changed</h4>
              <div className="prose prose-invert max-w-none whitespace-pre-wrap text-green-300 leading-relaxed border border-green-500/20 rounded-lg p-4 max-h-[60vh] overflow-y-auto">
                <DiffText content={contentB} type="added" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DiffText({ content, type }: { content: string | string[]; type: 'added' | 'removed' }) {
  const sentences = Array.isArray(content) ? content : content.split(/(?<=[.!?])\s+/);
  
  return (
    <div className="space-y-2">
      {sentences.map((sentence, idx) => (
        <span key={idx} className={cn(
          'inline-block px-1 py-0.5 rounded',
          type === 'added' ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300 line-through'
        )}>
          {sentence}
        </span>
      ))}
    </div>
  );
}

function computeDiff(textA: string, textB: string) {
  if (!textA && !textB) return { type: 'empty' as const };
  if (!textA) return { type: 'added' as const, contentB: textB };
  if (!textB) return { type: 'removed' as const, contentA: textA };
  if (textA === textB) return { type: 'unchanged' as const };
  
  const sentencesA = textA.split(/(?<=[.!?])\s+/);
  const sentencesB = textB.split(/(?<=[.!?])\s+/);
  
  return {
    type: 'modified' as const,
    contentA: sentencesA,
    contentB: sentencesB,
  };
}