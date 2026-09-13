import React, { useMemo, useState } from "react";
import Button from "../components/common/Button";
import Card from "../components/common/Card";
import PageHeader from "../components/common/PageHeader";
import { goalItems } from "../data/mockData";

const goalFilters = ["All", "Performance", "Financial", "Personal"];

const goalSummary = [
  {
    label: "Total Goals",
    value: "7",
    note: "Active goals",
    icon: "◎",
    tone: "blue",
  },
  {
    label: "Goals Achieved",
    value: "3",
    note: "42.9%",
    icon: "✓",
    tone: "green",
  },
  {
    label: "On Track",
    value: "4",
    note: "57.1%",
    icon: "↗",
    tone: "orange",
  },
  {
    label: "Completion Rate",
    value: "61%",
    note: "+12% vs last 30 days",
    icon: "◌",
    tone: "purple",
    positive: true,
  },
  {
    label: "Time Remaining",
    value: "45",
    suffix: "days",
    note: "Next goal deadline",
    icon: "▣",
    tone: "red",
  },
];

const recommendations = [
  {
    title: "Increase Trade Review",
    copy: "Reviewing losing trades can improve your win rate by 18%.",
    icon: "⌁",
    tone: "green",
  },
  {
    title: "Optimize London Session",
    copy: "You perform 23% better during London session. Consider focusing more on this time.",
    icon: "◷",
    tone: "orange",
  },
  {
    title: "Improve R:R Ratio",
    copy: "Your average R:R is 1.42. Aim for 1.5+ to maximize profits.",
    icon: "↗",
    tone: "blue",
  },
];

const habits = [
  {
    name: "Journal Every Trade",
    days: [1, 1, 1, 1, 1, 0, 0],
    score: "71%",
  },
  {
    name: "Review Trades Daily",
    days: [1, 1, 1, 1, 0, 0, 0],
    score: "57%",
  },
  {
    name: "No Revenge Trading",
    days: [1, 1, 1, "miss", 0, 0, 0],
    score: "60%",
  },
  {
    name: "Follow Risk Rules",
    days: [1, 1, 1, 1, 1, 1, 1],
    score: "100%",
  },
  {
    name: "Plan Before Trading",
    days: [1, 1, 1, 1, 1, 0, 0],
    score: "71%",
  },
];

const milestones = [
  {
    title: "First $1,000 Profit",
    description: "Reached your first $1,000 in profit.",
    date: "Apr 15, 2024",
    status: "✓ Achieved",
    icon: "♛",
    tone: "achieved",
  },
  {
    title: "Consistent Trader",
    description: "Traded 4 weeks in a row with profit.",
    date: "May 5, 2024",
    status: "✓ Achieved",
    icon: "♛",
    tone: "achieved",
  },
  {
    title: "Risk Master",
    description: "Maintained <1% risk for 30 trades.",
    date: "May 12, 2024",
    status: "✓ Achieved",
    icon: "♛",
    tone: "achieved",
  },
  {
    title: "$10K Profit Goal",
    description: "Grow account to $10,000 profit.",
    date: "Jul 31, 2024",
    status: "62% Complete",
    icon: "⚑",
    tone: "current",
  },
  {
    title: "100 Profitable Trades",
    description: "Achieve 100 trades with positive expectancy.",
    date: "Oct 31, 2024",
    status: "▣ Locked",
    icon: "▣",
    tone: "locked",
  },
  {
    title: "Financial Freedom",
    description: "Consistently withdraw $3,000/month.",
    date: "Dec 31, 2024",
    status: "▣ Locked",
    icon: "▣",
    tone: "locked",
  },
];

function formatPercent(value) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

function GoalSummary() {
  return (
    <section className="goal-summary-strip" aria-label="Goal summary">
      {goalSummary.map((item) => (
        <div className="goal-summary-item" key={item.label}>
          <span className={`goal-summary-icon ${item.tone}`}>{item.icon}</span>
          <div>
            <span className="goal-summary-label">{item.label}</span>
            <strong>
              {item.value} {item.suffix && <small>{item.suffix}</small>}
            </strong>
            <span className={`goal-summary-note ${item.positive ? "positive" : ""}`}>
              {item.note}
            </span>
          </div>
        </div>
      ))}
    </section>
  );
}

function GoalRow({ goal }) {
  return (
    <article className={`goal-row goal-row-${goal.tone}`}>
      <span className="goal-row-icon">{goal.icon}</span>
      <div className="goal-row-main">
        <div className="goal-row-heading">
          <h3>{goal.title}</h3>
          <span className="chip">{goal.category}</span>
        </div>
        <p>{goal.description}</p>
        <div className="goal-row-progress">
          <div className="goal-progress-track">
            <i style={{ width: `${Math.min(goal.progress, 100)}%` }} />
          </div>
          <span>
            {goal.currentLabel} / {goal.targetLabel}
          </span>
        </div>
      </div>
      <div className="goal-row-status">
        <strong>{formatPercent(goal.progress)}</strong>
        <span>Due: {goal.dueDate}</span>
        <em className={goal.remaining === "Always" ? "positive" : ""}>{goal.remaining}</em>
      </div>
    </article>
  );
}

function GoalsList() {
  const [activeFilter, setActiveFilter] = useState("All");
  const visibleGoals = goalItems.filter(
    (goal) => activeFilter === "All" || goal.filterCategory === activeFilter,
  );

  return (
    <Card className="goals-list-card">
      <div className="goals-list-header">
        <h2>My Goals (7)</h2>
        <div className="goal-filters" aria-label="Goal categories">
          {goalFilters.map((filter) => (
            <button
              className={activeFilter === filter ? "active" : ""}
              key={filter}
              onClick={() => setActiveFilter(filter)}
            >
              {filter}
            </button>
          ))}
          <button className="goal-filter-more" aria-label="More goal filters">
            ...
          </button>
        </div>
      </div>
      <div className="goal-rows">
        {visibleGoals.map((goal) => (
          <GoalRow goal={goal} key={goal.id} />
        ))}
      </div>
      <button className="goals-view-all">View all goals →</button>
    </Card>
  );
}

function calendarCells(date) {
  const localDateKey = (value) => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const previousMonthDays = new Date(year, month, 0).getDate();
  const totalCells = firstDay + daysInMonth > 35 ? 42 : 35;
  const cells = [];

  for (let index = firstDay - 1; index >= 0; index -= 1) {
    const day = previousMonthDays - index;
    const previousDate = new Date(year, month - 1, day);
    cells.push({
      day,
      outside: true,
      dateKey: localDateKey(previousDate),
    });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const calendarDate = new Date(year, month, day);
    cells.push({
      day,
      outside: false,
      dateKey: localDateKey(calendarDate),
    });
  }
  for (let day = 1; cells.length < totalCells; day += 1) {
    const nextDate = new Date(year, month + 1, day);
    cells.push({
      day,
      outside: true,
      dateKey: localDateKey(nextDate),
    });
  }
  return cells;
}

function GoalsCalendar() {
  const [monthDate, setMonthDate] = useState(new Date(2024, 4, 1));
  const cells = useMemo(() => calendarCells(monthDate), [monthDate]);
  const monthLabel = monthDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const changeMonth = (amount) => {
    setMonthDate(
      (current) => new Date(current.getFullYear(), current.getMonth() + amount, 1),
    );
  };

  return (
    <Card className="goals-calendar-card">
      <div className="calendar-header">
        <h2>Goals Calendar</h2>
        <div className="calendar-month-controls">
          <button onClick={() => changeMonth(-1)} aria-label="Previous month">
            ‹
          </button>
          <strong>{monthLabel}</strong>
          <button onClick={() => changeMonth(1)} aria-label="Next month">
            ›
          </button>
        </div>
      </div>
      <div className="calendar-weekdays">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="goals-calendar-grid">
        {cells.map((cell) => (
          <span
            className={`${cell.outside ? "outside" : ""} ${cell.dateKey === "2024-05-18" ? "selected" : ""}`}
            key={cell.dateKey}
          >
            {cell.day}
          </span>
        ))}
      </div>
      <div className="calendar-legend">
        <span className="legend-blue">Goal Due</span>
        <span className="legend-green">Milestone</span>
        <span className="legend-purple">Completed</span>
      </div>
    </Card>
  );
}

function AiGoalSummary() {
  const insights = [
    {
      title: "Your consistency is improving",
      copy: "You traded 12% more frequently than last month.",
      icon: "↗",
      tone: "green",
    },
    {
      title: "Focus Area: Position Sizing",
      copy: "Your average risk is good. Keep it below 1% to protect your capital.",
      icon: "◎",
      tone: "purple",
    },
    {
      title: "AI Prediction",
      copy: "You have a 78% chance of achieving 2 of your goals this quarter.",
      icon: "✦",
      tone: "blue",
    },
  ];

  return (
    <Card className="ai-goal-summary">
      <div className="goal-card-heading">
        <h2>
          <span className="sparkle">✦</span> AI Goal Summary
        </h2>
        <span className="beta-chip">BETA</span>
      </div>
      <p className="ai-intro">
        You're making great progress! Keep focusing on consistency and risk management.
      </p>
      <div className="goal-insights">
        {insights.map((insight) => (
          <div className="goal-insight" key={insight.title}>
            <span className={`goal-insight-icon ${insight.tone}`}>{insight.icon}</span>
            <div>
              <strong>{insight.title}</strong>
              <p>{insight.copy}</p>
            </div>
          </div>
        ))}
      </div>
      <button className="goals-view-all">View AI Insights Report →</button>
    </Card>
  );
}

function AiRecommendations() {
  return (
    <Card className="ai-recommendations">
      <div className="goal-card-heading">
        <h2>AI Recommendations</h2>
        <span className="beta-chip">BETA</span>
      </div>
      <p className="card-subtitle">
        Personalized suggestions based on your performance and goals.
      </p>
      <div className="recommendation-list">
        {recommendations.map((recommendation) => (
          <div className="recommendation-row" key={recommendation.title}>
            <span className={`recommendation-icon ${recommendation.tone}`}>
              {recommendation.icon}
            </span>
            <div>
              <strong>{recommendation.title}</strong>
              <p>{recommendation.copy}</p>
            </div>
            <button>View</button>
          </div>
        ))}
      </div>
      <button className="goals-view-all">View All Recommendations →</button>
    </Card>
  );
}

function HabitStatus({ value }) {
  if (value === 1) return <span className="habit-status check">✓</span>;
  if (value === "miss") return <span className="habit-status miss">×</span>;
  return <span className="habit-status empty" />;
}

function HabitsTracker() {
  return (
    <Card className="habits-tracker">
      <div className="habits-header">
        <h2>Habits Tracker</h2>
        <select className="field" defaultValue="This Week" aria-label="Habit period">
          <option>This Week</option>
          <option>Last Week</option>
          <option>This Month</option>
        </select>
      </div>
      <div className="habits-table-wrap">
        <table className="habits-table">
          <thead>
            <tr>
              <th>Habit</th>
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                <th key={day}>{day}</th>
              ))}
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {habits.map((habit) => (
              <tr key={habit.name}>
                <th>{habit.name}</th>
                {habit.days.map((value, index) => (
                  <td key={`${habit.name}-${index}`}>
                    <HabitStatus value={value} />
                  </td>
                ))}
                <td className={habit.score === "100%" ? "positive" : ""}>
                  {habit.score}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="goals-view-all">View Habit Analytics →</button>
    </Card>
  );
}

function Milestones() {
  return (
    <Card className="milestones-card">
      <div className="goals-section-heading">
        <h2>Milestones &amp; Achievements</h2>
      </div>
      <div className="milestone-grid">
        {milestones.map((milestone) => (
          <article className={`milestone-card milestone-${milestone.tone}`} key={milestone.title}>
            <span className="milestone-icon">{milestone.icon}</span>
            <h3>{milestone.title}</h3>
            <p>{milestone.description}</p>
            <small>{milestone.date}</small>
            <strong>{milestone.status}</strong>
          </article>
        ))}
      </div>
      <div className="milestone-timeline" aria-hidden="true">
        {milestones.map((milestone) => (
          <span className={`timeline-marker ${milestone.tone}`} key={milestone.title} />
        ))}
      </div>
      <button className="goals-view-all">View All Milestones →</button>
    </Card>
  );
}

function WeeklyReflection() {
  const [reflection, setReflection] = useState("");
  const [saved, setSaved] = useState(false);

  return (
    <section className="weekly-reflection">
      <div className="reflection-quote">
        <span className="large-quote">“</span>
        <p>
          A goal without a plan is just a wish.
          <br />
          A plan with discipline becomes your reality.
        </p>
        <cite>– Forex Journey</cite>
      </div>
      <div className="reflection-form">
        <h2>Weekly Reflection</h2>
        <p>How did you do this week toward your goals?</p>
        <div className="reflection-input-wrap">
          <textarea
            maxLength={500}
            onChange={(event) => {
              setReflection(event.target.value);
              setSaved(false);
            }}
            placeholder="Write your reflection..."
            value={reflection}
          />
          <span>{reflection.length} / 500</span>
        </div>
        <Button primary onClick={() => setSaved(true)}>
          {saved ? "Saved" : "Save Reflection"}
        </Button>
      </div>
      <div className="reflection-art" aria-hidden="true">
        <span className="reflection-mountain mountain-back" />
        <span className="reflection-mountain mountain-front" />
        <span className="reflection-flagpole">
          <i />
        </span>
        <span className="reflection-climber" />
      </div>
    </section>
  );
}

export default function Goals() {
  return (
    <div className="goals-page">
      <PageHeader
        title="◎ Goals"
        sub="Set goals. Track progress. Build discipline. Achieve freedom."
      >
        <Button primary>＋ New Goal</Button>
        <Button>⚙ Goals Settings</Button>
      </PageHeader>

      <GoalSummary />

      <div className="goals-top-grid">
        <GoalsList />
        <div className="goals-calendar-column">
          <GoalsCalendar />
          <AiGoalSummary />
        </div>
      </div>

      <div className="goals-second-grid">
        <AiRecommendations />
        <HabitsTracker />
      </div>

      <Milestones />
      <WeeklyReflection />
    </div>
  );
}
