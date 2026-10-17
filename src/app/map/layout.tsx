/**
 * The map, plus a slot for a photo opened from it. Clicking a photo pushes /p/<slug>;
 * @modal/(..)p intercepts that navigation and draws the photo page over the map, so the
 * map stays mounted (and isn't reloaded) underneath. Visiting /p/<slug> directly still
 * renders the standalone page in app/p.
 */
export default function MapLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
