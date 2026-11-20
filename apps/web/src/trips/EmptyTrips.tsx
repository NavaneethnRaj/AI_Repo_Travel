export interface EmptyTripsProps {
  onStart: () => void;
}

export function EmptyTrips({ onStart }: EmptyTripsProps) {
  return (
    <div className="surface empty-state">
      <h2>No trips yet</h2>
      <p>You haven't started any trips yet. Begin planning your next journey.</p>
      <button className="primary" type="button" onClick={onStart}>
        Start a trip
      </button>
    </div>
  );
}
