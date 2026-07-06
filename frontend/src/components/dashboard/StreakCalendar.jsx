import { format, subDays } from 'date-fns';

export default function StreakCalendar({ activity = {} }) {
  // Build last 7 days
  const days = Array.from({ length: 7 }, (_, i) => {
    const date    = subDays(new Date(), 6 - i);
    const dateStr = format(date, 'yyyy-MM-dd');
    const dayName = format(date, 'EEE');
    const isToday = i === 6;
    const done    = activity[dateStr] || false;

    return { dateStr, dayName, isToday, done };
  });

  return (
    <div className="card">
      <h3 className="text-white font-semibold mb-4">This Week</h3>
      <div className="flex justify-between">
        {days.map(({ dateStr, dayName, isToday, done }) => (
          <div key={dateStr} className="flex flex-col items-center gap-2">
            <span className={`text-xs font-medium
              ${isToday ? 'text-primary-400' : 'text-gray-500'}`}>
              {dayName}
            </span>
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center
              transition-all duration-200
              ${done
                ? 'bg-primary-600 shadow-lg shadow-primary-600/30'
                : isToday
                  ? 'bg-dark-300 border-2 border-primary-500/50'
                  : 'bg-dark-300'
              }`}>
              {done ? (
                <span className="text-white text-sm">✓</span>
              ) : (
                <span className={`text-xs
                  ${isToday ? 'text-primary-400' : 'text-gray-600'}`}>
                  {format(new Date(dateStr), 'd')}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}