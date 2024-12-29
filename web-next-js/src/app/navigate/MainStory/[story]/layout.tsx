export default function MainStoryLayout({ children }: { children: React.ReactNode }) {
  return (
      <div style={{ position: 'fixed', height: '100%', width: '100%' }}>
          {children}
      </div>
  );
}