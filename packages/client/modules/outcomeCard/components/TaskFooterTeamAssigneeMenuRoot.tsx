import React from 'react'
import graphql from 'babel-plugin-relay/macro'
import QueryRenderer from '../../../components/QueryRenderer/QueryRenderer'
import useAtmosphere from '../../../hooks/useAtmosphere'
import {MenuProps} from '../../../hooks/useMenu'
import TaskFooterTeamAssigneeMenu from './OutcomeCardAssignMenu/TaskFooterTeamAssigneeMenu'
import {cacheConfig} from '../../../utils/constants'
import renderQuery from '../../../utils/relay/renderQuery'
import {UseTaskChild} from '../../../hooks/useTaskChildFocus'

const query = graphql`
  query TaskFooterTeamAssigneeMenuRootQuery {
    viewer {
      ...TaskFooterTeamAssigneeMenu_viewer
    }
  }
`

interface Props {
  menuProps: MenuProps
  task: any
  useTaskChild: UseTaskChild
}

const TaskFooterTeamAssigneeMenuRoot = (props: Props) => {
  const {menuProps, task, useTaskChild} = props
  const atmosphere = useAtmosphere()
  useTaskChild('teamAssignee')
  return (
    <QueryRenderer
      cacheConfig={cacheConfig}
      environment={atmosphere}
      query={query}
      render={renderQuery(TaskFooterTeamAssigneeMenu, {props: {menuProps, task}})}
    />
  )
}

export default TaskFooterTeamAssigneeMenuRoot