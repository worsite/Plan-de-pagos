// La anon key es pública por diseño: sin una sesión válida no da acceso a ningún dato
// (las tablas están bloqueadas y todo pasa por funciones que exigen token).
export const CONFIG = {
  url: 'https://dkedthucolhjdjvlpnri.supabase.co',
  anonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrZWR0aHVjb2xoamRqdmxwbnJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQyNTQ2MDksImV4cCI6MjEwOTgzMDYwOX0.aW8nrzdxeGFqQoCe94i5QnvDdeMgTWFToawLL8mIqOA',
};
