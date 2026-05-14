import {
  Input,
  Select,
  Option,
  Dialog,
  TabGroup,
  Tab,
  TabPanel,
} from './components'

describe('webawesome React wrappers', () => {
  it('exports React-renderable wrappers for the migrated WA components', () => {
    // createComponent from @lit/react returns a React component
    // function (forwardRef). truthy is enough — at runtime they
    // are usable React elements.
    expect(Input).toBeTruthy()
    expect(Select).toBeTruthy()
    expect(Option).toBeTruthy()
    expect(Dialog).toBeTruthy()
    expect(TabGroup).toBeTruthy()
    expect(Tab).toBeTruthy()
    expect(TabPanel).toBeTruthy()
  })
})
