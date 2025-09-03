import React, { useState } from 'react';

function App() {
  const [palot, setPalot] = useState('');

  return (
    <div>
      <h1>Olive Tracking</h1>
      <p>Introduce un número de palot:</p>
      <input value={palot} onChange={e => setPalot(e.target.value)} />
    </div>
  );
}

export default App;
