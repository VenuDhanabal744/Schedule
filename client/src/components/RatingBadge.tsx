import type { Rating } from '../types';

export function RatingBadge({ rating }: { rating: Rating | undefined }) {
  if (rating === undefined) return <span className="rating loading">…</span>;
  if (rating === null) return <span className="rating none">no rating</span>;
  const cls = rating.avgRating >= 4 ? 'good' : rating.avgRating >= 3 ? 'mid' : 'bad';
  return (
    <a
      className={`rating ${cls}`}
      href={rating.url}
      target="_blank"
      rel="noreferrer"
      title={`${rating.name} — ${rating.numRatings} ratings, difficulty ${rating.avgDifficulty}/5${
        rating.wouldTakeAgain != null && rating.wouldTakeAgain >= 0
          ? `, ${Math.round(rating.wouldTakeAgain)}% would take again`
          : ''
      } (RateMyProfessors)`}
    >
      ★ {rating.avgRating.toFixed(1)}
      <span className="rating-n">({rating.numRatings})</span>
    </a>
  );
}
