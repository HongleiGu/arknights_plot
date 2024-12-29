export default function MainStoryLayout({ children }: { children: React.ReactNode }) {
  return (
      <div style={{ position: 'fixed', height: '100%', width: '100%', top: 0, left: 0, zIndex: 1000}}>
          {children}
      </div>
  );
}