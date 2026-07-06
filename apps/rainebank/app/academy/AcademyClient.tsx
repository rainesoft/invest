"use client";

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { Search, Lock, Clock } from 'lucide-react';
import { ACADEMY_POSTS, Category } from '../../data/academy';

export default function AcademyClient() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<Category | 'All'>('All');

  const filteredPosts = useMemo(() => {
    return ACADEMY_POSTS.filter((post) => {
      const matchesSearch = 
        post.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
        post.excerpt.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = activeCategory === 'All' || post.category === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, activeCategory]);

  return (
    <div>
      {/* Filters & Search */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginBottom: '48px' }}>
        <div style={{ position: 'relative', width: '100%', maxWidth: '600px', margin: '0 auto' }}>
          <Search size={20} color="var(--text-secondary)" style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            placeholder="Search guides, strategies, and tutorials..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%', padding: '16px 16px 16px 48px',
              background: 'var(--panel-bg)', border: '1px solid var(--border-color)',
              borderRadius: '100px', color: 'var(--text-primary)', fontSize: '16px',
              outline: 'none', transition: 'border-color 0.2s', boxShadow: '0 4px 24px rgba(0,0,0,0.1)'
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          {['All', 'Setup Guides', 'Trading Alpha', 'Platform Updates'].map((category) => (
            <button
              key={category}
              onClick={() => setActiveCategory(category as Category | 'All')}
              style={{
                padding: '8px 20px', borderRadius: '100px', fontSize: '14px', fontWeight: 500, cursor: 'pointer',
                border: `1px solid ${activeCategory === category ? 'var(--accent)' : 'var(--border-color)'}`,
                background: activeCategory === category ? 'var(--accent)' : 'transparent',
                color: activeCategory === category ? '#fff' : 'var(--text-secondary)',
                transition: 'all 0.2s'
              }}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '24px' }}>
        {filteredPosts.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '64px', color: 'var(--text-secondary)' }}>
            No articles found matching your search.
          </div>
        ) : (
          filteredPosts.map((post) => (
            <Link key={post.id} href={`/academy/${post.slug}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div style={{
                background: 'var(--panel-bg)', border: '1px solid var(--border-color)',
                borderRadius: '16px', padding: '24px', height: '100%',
                display: 'flex', flexDirection: 'column', transition: 'transform 0.2s, box-shadow 0.2s',
                cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-4px)';
                e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,0,0,0.15)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.05)';
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {post.category}
                  </span>
                  {post.isPremium && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(234, 179, 8, 0.1)', color: '#eab308', padding: '4px 10px', borderRadius: '100px', fontSize: '12px', fontWeight: 600 }}>
                      <Lock size={12} /> PRO
                    </span>
                  )}
                </div>
                
                <h2 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 12px 0', lineHeight: '1.4', color: 'var(--text-primary)' }}>
                  {post.title}
                </h2>
                
                <p style={{ fontSize: '15px', color: 'var(--text-secondary)', lineHeight: '1.6', margin: '0 0 24px 0', flex: 1 }}>
                  {post.excerpt}
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', color: 'var(--text-secondary)', fontSize: '13px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                  <span>{new Date(post.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Clock size={14} /> {post.readTime}
                  </span>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
