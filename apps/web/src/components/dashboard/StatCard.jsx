export default function StatCard({ icon: Icon, label, value, color, subtitle }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center
          ${color.replace('text-', 'bg-').replace('400', '500/20')
                 .replace('300', '500/20')}`}>
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
      </div>
      <p className="text-gray-400 text-sm">{label}</p>
      <p className="text-white font-bold text-2xl mt-1">{value}</p>
      {subtitle && (
        <p className="text-gray-500 text-xs mt-1">{subtitle}</p>
      )}
    </div>
  );
}