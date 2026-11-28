// Overview's money boxes in the third look (ROADMAP V5-b; boards `OverviewMoney`, `OverviewMoneyStates`): the box,
// its title, the count in one line and what it is for; a person's row with their name, Past member and the amount.

/** The box: a title, then the count and the line saying what the box is for, then whatever the box holds. */
export function MoneyBox({ id, testId, title, headline = null, headlineTestId, intro = null, children }) {
  return (
    <section id={id} data-testid={testId} aria-label={title} className="c-card c-ov-box c-ov-money" style={{ scrollMarginTop: 16 }}>
      <div className="c-ov-box-head">
        <h2 className="c-h2">{title}</h2>
      </div>
      {headline !== null || intro !== null ? (
        <div className="c-ov-box-body flex flex-col gap-1">
          {headline !== null ? (
            <p className="c-s15 c-w6 c-t1 m-0" data-testid={headlineTestId}>
              {headline}
            </p>
          ) : null}
          {intro !== null ? <p className="c-s14 c-t2 m-0">{intro}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** A row's first line: the name (a button to their page where there is one), Past member, the amount at the end. */
export function MoneyWho({ name, onOpen = null, openLabel, past = false, amount = null }) {
  return (
    <div className="c-ov-money-top">
      {onOpen !== null ? (
        <button type="button" className="c-ov-money-who" onClick={onOpen} aria-label={openLabel}>
          {name}
        </button>
      ) : (
        <span className="c-ov-money-who">{name}</span>
      )}
      {past ? <span className="c-tag c-tag-plain">Past member</span> : null}
      {amount !== null ? <span className="c-sale-row-money c-ov-money-amt">{amount}</span> : null}
    </div>
  );
}
