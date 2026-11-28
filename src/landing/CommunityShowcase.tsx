import React, { useEffect, useMemo, useRef, useState } from 'react';
import FlexCarousel, { type FlexCarouselHandle, type FlexCarouselItem } from '../components/FlexCarousel';
import studyCircleImg from '../assets/images/community_study_circle_1795852558465.jpg';
import boutiqueAtelierImg from '../assets/images/community_boutique_atelier_1795852559360.jpg';
import designCritiqueImg from '../assets/images/community_design_critique_1795852559595.jpg';
import campusCourtyardImg from '../assets/images/community_campus_courtyard_1795852559658.jpg';

type CategoryKey = 'all' | 'social' | 'shop' | 'learn';

interface CommunityItem extends FlexCarouselItem {
  id: string;
  category: Exclude<CategoryKey, 'all'>;
  href: string;
  featured?: boolean;
}

const COMMUNITY_ITEMS: CommunityItem[] = [
  {
    id: 'north-quad-walk',
    src: campusCourtyardImg,
    alt: 'Students and friends sketching together on sunlit stone steps in a campus courtyard',
    title: 'North Quad Sketch & Music Walk',
    subtitle: 'Social · Campus Circles',
    category: 'social',
    href: '#radar-feature',
    featured: true
  },
  {
    id: 'claire-espresso-circle',
    src: '/assets/images/claire-cafe.jpg',
    alt: 'Claire enjoying coffee with her circle at a neighborhood sidewalk café',
    title: 'Weekend Espresso Circle · @claire.m',
    subtitle: 'Social · Nearby Discovery',
    category: 'social',
    href: '#radar-feature',
    featured: true
  },
  {
    id: 'atelier-rowan-showroom',
    src: boutiqueAtelierImg,
    alt: 'Shopper browsing tailored linen sweaters and trench coats in an independent boutique',
    title: 'Atelier Rowan Autumn Showroom',
    subtitle: 'Shop · Partner Stores',
    category: 'shop',
    href: '#outfit-builder',
    featured: true
  },
  {
    id: 'architecture-reading-room',
    src: studyCircleImg,
    alt: 'Four university students collaborating around a warm wooden library table',
    title: 'Architecture & Literature Reading Room',
    subtitle: 'Learn · Verified Class Spaces',
    category: 'learn',
    href: '#schools',
    featured: true
  },
  {
    id: 'studio-lookbook-tryon',
    src: '/assets/images/tryon-linen.jpg',
    alt: 'Virtual try-on garment preview of relaxed ivory linen tailoring',
    title: 'Studio Lookbook Try-On Preview',
    subtitle: 'Shop · Personal Fitting Room',
    category: 'shop',
    href: '#tryon-feature',
    featured: true
  },
  {
    id: 'thursday-studio-critique',
    src: designCritiqueImg,
    alt: 'Designers reviewing architectural models and floorplans at a wooden table',
    title: 'Thursday Evening Studio Critique',
    subtitle: 'Learn · Peer Review Groups',
    category: 'learn',
    href: '#schools',
    featured: false
  }
];

const FILTERS: { key: CategoryKey; label: string }[] = [
  { key: 'all', label: 'All Moments' },
  { key: 'social', label: 'Social Circles' },
  { key: 'shop', label: 'Partner Stores' },
  { key: 'learn', label: 'Campus & Learn' }
];

export const CommunityShowcase: React.FC = () => {
  const carouselRef = useRef<FlexCarouselHandle>(null);
  const [filter, setFilter] = useState<CategoryKey>('all');
  const [activeIndex, setActiveIndex] = useState(0);
  const [loopOrder, setLoopOrder] = useState<string[] | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/discovery/community-loop?category=${encodeURIComponent(filter)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (!active || !payload?.loop?.items) return;
        const ids = (payload.loop.items as Array<{ id?: string }>)
          .map((item) => item.id)
          .filter((id): id is string => Boolean(id));
        if (ids.length > 0) {
          setLoopOrder(ids);
        }
      })
      .catch(() => {
        // Local spatial defaults remain active silently
      });
    return () => {
      active = false;
    };
  }, [filter]);

  const visibleItems = useMemo(() => {
    const base =
      filter === 'all'
        ? COMMUNITY_ITEMS.filter(item => item.featured).slice(0, 5)
        : COMMUNITY_ITEMS.filter(item => item.category === filter).slice(0, 3);
    if (!loopOrder || loopOrder.length === 0) return base;
    const rank = new Map(loopOrder.map((id, idx) => [id, idx]));
    return [...base].sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
  }, [filter, loopOrder]);

  const currentItem = visibleItems[activeIndex] || visibleItems[0];

  const handleFilterChange = (next: CategoryKey) => {
    setFilter(next);
    setActiveIndex(0);
  };

  return (
    <div className="nx-community-shell">
      <div className="nx-container">
        <div className="nx-community-header">
          <div className="nx-community-heading-block">
            <p className="nx-kicker">Community in motion</p>
            <h2 className="nx-headline-lg" id="community-heading">
              Shared reels, partner stores, and campus spaces.
            </h2>
            <p className="nx-body-md nx-section-lead">
              Scroll, drag, or click any frame across curated Nexora moments to focus closer.
            </p>
          </div>

          <div className="nx-community-tabs" role="tablist" aria-label="Filter community moments">
            {FILTERS.map(tab => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={filter === tab.key}
                className={`nx-community-tab${filter === tab.key ? ' is-active' : ''}`}
                onClick={() => handleFilterChange(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="nx-community-stage">
        <FlexCarousel
          ref={carouselRef}
          items={visibleItems}
          preset="liquid"
          intro="rise"
          fit="portrait"
          cardHeight={0.5}
          gap={12}
          radius={14}
          liquid={0.26}
          squeeze={0.2}
          followCursor
          infinite
          captureWheel={false}
          reactToPageScroll
          focusOnClick
          captions
          onChange={idx => setActiveIndex(idx)}
        />
      </div>

      <div className="nx-container">
        <div className="nx-community-footer">
          <div className="nx-community-controls">
            <button
              type="button"
              className="nx-btn nx-btn-outline nx-community-nav-btn"
              onClick={() => carouselRef.current?.step(-1)}
              aria-label="Previous community moment"
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                arrow_back
              </span>
              <span>Previous</span>
            </button>
            <button
              type="button"
              className="nx-btn nx-btn-outline nx-community-nav-btn"
              onClick={() => carouselRef.current?.step(1)}
              aria-label="Next community moment"
            >
              <span>Next</span>
              <span className="material-symbols-outlined" aria-hidden="true">
                arrow_forward
              </span>
            </button>
          </div>

          {currentItem && (
            <a href={currentItem.href} className="nx-pillar-link nx-community-cta">
              <span>
                Explore {currentItem.category === 'shop' ? 'Partner Stores' : currentItem.category === 'learn' ? 'Learn Spaces' : 'Social'}
              </span>
              <span aria-hidden="true">→</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
};
