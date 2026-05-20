type TeamItem = {
  name: string;
  isLeader: boolean;
};

type CollaboratorTeamCellProps = {
  teams: TeamItem[];
};

export default function CollaboratorTeamCell({ teams }: CollaboratorTeamCellProps) {
  if (teams.length === 0) {
    return <span className="collaborator-cell-text">-</span>;
  }

  const mainTeam = teams[0];
  const extraTeams = teams.slice(1);
  const fullTeamList = teams
    .map((team) => `${team.isLeader ? 'Chefe · ' : ''}${team.name}`)
    .join(' • ');

  return (
    <div className="collaborator-team-cell" title={fullTeamList}>
      <span className={`collaborator-team-chip${mainTeam.isLeader ? ' is-leader' : ''}`}>
        {mainTeam.isLeader ? 'Chefe · ' : ''}{mainTeam.name}
      </span>
      {extraTeams.length > 0 && (
        <span className="collaborator-team-more">+{extraTeams.length}</span>
      )}
    </div>
  );
}
