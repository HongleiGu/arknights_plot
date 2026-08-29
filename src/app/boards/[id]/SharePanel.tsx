'use client'

// Board sharing (AP-12). The dialog itself is generic — saved AI sessions
// (AP-20) render the same one — so this only binds it to the board actions.

import ShareDialog from '@/components/ShareDialog'
import {
  listCollaborators,
  inviteCollaborator,
  updateCollaboratorRole,
  removeCollaborator,
  updateBoard,
  type Board,
  type BoardVisibility,
} from '@/app/actions/boards'

export default function SharePanel({ board, onClose }: { board: Board; onClose: () => void }) {
  return (
    <ShareDialog
      name={board.title}
      linkPath={`/boards/${board.id}`}
      visibility={board.visibility}
      setVisibility={v => updateBoard(board.id, { visibility: v as BoardVisibility })}
      load={() => listCollaborators(board.id)}
      invite={(email, role) => inviteCollaborator(board.id, email, role)}
      setRole={(userId, role) => updateCollaboratorRole(board.id, userId, role)}
      remove={userId => removeCollaborator(board.id, userId)}
      onClose={onClose}
    />
  )
}
