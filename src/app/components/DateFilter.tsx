import React, { useMemo } from 'react';

interface DateFilterProps {
    photos: { date?: string }[];
    selectedYear: number | null;
    onYearChange: (year: number | null) => void;
}

const DateFilter: React.FC<DateFilterProps> = ({ photos, selectedYear, onYearChange }) => {
    const years = useMemo(() => {
        const uniqueYears = new Set<number>();
        photos.forEach(photo => {
            if (photo.date) {
                const year = new Date(photo.date).getFullYear();
                uniqueYears.add(year);
            }
        });
        return Array.from(uniqueYears).sort((a, b) => b - a);
    }, [photos]);

    if (years.length === 0) return null;

    return (
        <div className="date-filter-container">
            <button
                className={`filter-chip ${selectedYear === null ? 'active' : ''}`}
                onClick={() => onYearChange(null)}
            >
                All
            </button>
            {years.map(year => (
                <button
                    key={year}
                    className={`filter-chip ${selectedYear === year ? 'active' : ''}`}
                    onClick={() => onYearChange(year)}
                >
                    {year}
                </button>
            ))}
        </div>
    );
};

export default DateFilter;
